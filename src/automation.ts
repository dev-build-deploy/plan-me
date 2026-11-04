/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { RawIssue } from "./api";
import { Backlog, FieldValues } from "./backlog";
import { componentLabel, SelectField } from "./config";
import { checkIssue, IssueCheckOptions, IssueReport, problemLines, skeletonFor } from "./issue-check";
import { compareItems, Item, toItem, toItems } from "./item";
import { COMPONENT_HEADING, parseFormAnswers } from "./templates";

/** The parts of a pull request event plan-me reads. */
export interface PullRequestInfo {
  number: number;
  /** opened, edited, synchronize, reopened, ready_for_review, closed, ... */
  action: string;
  merged: boolean;
  body: string;
  branch: string;
}

/** The issues a pull request references, by kind. */
export interface References {
  /** `Closes #n` (and fixes/resolves): done and closed on merge. */
  closes: number[];
  /** `Part of #n`: in-progress while open; left in-progress on merge. */
  partOf: number[];
  /** The id in the branch name (`feat/12-x`, or a marker id as the last segment): done on merge. */
  branch: number[];
}

const CLOSES = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)/gi;
const PART_OF = /\bpart of\s*:?\s+#(\d+)/gi;
const OPEN_ACTIONS = ["opened", "edited", "synchronize", "reopened", "ready_for_review"];

/** The `#n` numbers a regex finds in a text, unique, in order. */
function numbers(text: string, re: RegExp): number[] {
  return [...new Set([...text.matchAll(re)].map(m => +m[1]))];
}

/**
 * Finds the issues a pull request references (body keywords and branch name).
 * @param pattern The branch pattern (a regex whose first group is the issue number)
 */
export function findReferences(body: string, branch: string, pattern: string): References {
  const closes = numbers(body, CLOSES);
  const partOf = numbers(body, PART_OF).filter(n => !closes.includes(n));
  const m = new RegExp(pattern).exec(branch);
  const fromBranch = m ? [+m[1]].filter(n => !closes.includes(n) && !partOf.includes(n)) : [];
  return { closes, partOf, branch: fromBranch };
}

/**
 * A pull request event: open -> referenced issues in-progress; merged -> Closes and branch issues done (closed);
 * `Part of` issues stay in-progress. Returns one line per change.
 */
export async function onPullRequest(backlog: Backlog, pr: PullRequestInfo): Promise<string[]> {
  const refs = findReferences(pr.body, pr.branch, backlog.config.branchPattern);
  if (refs.branch.length === 0 && refs.closes.length === 0 && refs.partOf.length === 0) {
    const segment = pr.branch.split("/").pop() ?? "";
    const id = await backlog.resolve(segment).catch(() => undefined);
    if (id !== undefined) refs.branch.push(id);
  }
  const lines: string[] = [];
  const all = [...refs.closes, ...refs.partOf, ...refs.branch];
  if (pr.action === "closed") {
    if (!pr.merged) return lines;
    for (const n of [...refs.closes, ...refs.branch]) {
      const outcome = await backlog.done(n, `Merged in #${pr.number}.`);
      if (outcome.changed) lines.push(`#${n} done (merged #${pr.number})`);
    }
    return lines;
  }
  if (!OPEN_ACTIONS.includes(pr.action)) return lines;
  for (const n of all) {
    const item = await backlog.show(n).catch(() => undefined);
    if (!item || !item.open || item.status === "in-progress") continue;
    await backlog.setStatus(n, "in-progress");
    lines.push(`#${n} in-progress (#${pr.number})`);
  }
  return lines;
}

/** Whether an item is blocked only by status: it had blockers and they are all closed now. */
function unblockable(item: Item, hadBlockers: boolean): boolean {
  return item.open && item.status === "blocked" && item.blockedBy.length === 0 && hadBlockers;
}

/** One item's sweep: the unblock, a missing Status and a missing Priority. */
async function sweepItem(backlog: Backlog, item: Item, hadBlockers: boolean, raw?: RawIssue): Promise<string[]> {
  const lines: string[] = [];
  const config = backlog.config;
  if (!config.boards[item.component]) return lines;
  if (unblockable(item, hadBlockers)) {
    await backlog.setStatus(item.number, "open");
    await backlog.api.comment(item.number, "plan-me: unblocked, all blockers are closed.");
    lines.push(`#${item.number} unblocked`);
  }
  const values = raw?.boards[config.boards[item.component].title] ?? {};
  if (values[config.fields.status.name] === undefined && item.status === "open") {
    await backlog.setStatus(item.number, "open", true);
    lines.push(`#${item.number} status open`);
  }
  const dflt = config.fields.priority.default;
  if (item.priority === undefined && dflt) {
    await backlog.update(item.number, { priority: dflt });
    await backlog.api.comment(item.number, `plan-me: no priority set, defaulted to ${dflt}.`);
    lines.push(`#${item.number} priority ${dflt}`);
  }
  return lines;
}

/**
 * Keeps the open backlog consistent: a missing Priority gets the default (and a comment), a missing Status becomes
 * open, and blocked items whose blockers are all closed go back to open (with a comment). Idempotent.
 * @param only Restrict to these issue numbers (e.g. the issue of an `issues` event). With native dependencies only
 * those issues are read; otherwise (body-line blockers) the open backlog is read once to resolve them.
 */
export async function sweep(backlog: Backlog, only?: number[]): Promise<string[]> {
  const config = backlog.config;
  const native = only !== undefined && (await backlog.api.features()).dependencies;
  const raws = native
    ? (await Promise.all(only.map(async n => backlog.api.getIssue(n)))).filter((r): r is RawIssue => !!r?.open)
    : await backlog.api.listIssues(false);
  const rawOf = new Map(raws.map(r => [r.number, r]));
  const items = (native ? raws.map(r => toItem(config, r)) : toItems(config, raws, false))
    .filter(i => i.open && (!only || only.includes(i.number)))
    .sort((a, c) => compareItems(config, a, c));
  const lines: string[] = [];
  for (const item of items) {
    const raw = rawOf.get(item.number);
    lines.push(...(await sweepItem(backlog, item, (raw?.blockedBy.length ?? 0) > 0, raw)));
  }
  return lines;
}

/**
 * An issue was closed: its status becomes done, and its dependents are unblocked when free. With native dependencies
 * only the issues it blocked are read (a burst of closes stays cheap); otherwise the whole backlog is swept.
 */
export async function onIssueClosed(backlog: Backlog, number: number): Promise<string[]> {
  const lines: string[] = [];
  const outcome = await backlog.done(number);
  if (outcome.changed) lines.push(`#${number} done`);
  if (!(await backlog.api.features()).dependencies) return [...lines, ...(await sweep(backlog))];
  const closed = await backlog.api.getIssue(number);
  const dependents = (closed?.blocking ?? []).filter(l => l.open !== false).map(l => l.number);
  if (dependents.length === 0) return lines;
  for (const n of dependents) {
    const raw = await backlog.api.getIssue(n);
    if (!raw?.open) continue;
    const item = toItem(backlog.config, raw);
    if (!backlog.config.boards[item.component] || !unblockable(item, raw.blockedBy.length > 0)) continue;
    await backlog.setStatus(n, "open");
    await backlog.api.comment(n, "plan-me: unblocked, all blockers are closed.");
    lines.push(`#${n} unblocked`);
  }
  return lines;
}

/** The option key for a form answer (an option name or key); free text for a field without options. */
function optionKey(field: SelectField, answer: string | undefined): string | undefined {
  if (answer === undefined) return undefined;
  const options = Object.entries(field.options);
  if (options.length === 0) return answer;
  return options.find(([key, name]) => name === answer || key === answer)?.[0];
}

/**
 * An issue was opened from one of plan-me's issue forms: its answers become the fields and labels. The
 * Component answer adds the component label (unless the issue already has one); Priority, Role and Effort (the
 * configured field names) set the fields (Priority and Effort as issue fields where the organization has them); a Decision opens as needs-decision. An issue without form answers
 * (opened by `new`, or a blank issue) is left to the sweep. Returns one line per change.
 */
export async function onIssueOpened(backlog: Backlog, number: number): Promise<string[]> {
  const config = backlog.config;
  const item = await backlog.show(number);
  const answers = parseFormAnswers(item.body);
  const f = config.fields;
  const headings = [COMPONENT_HEADING, f.priority.name, f.role.name, f.effort.name];
  if (!headings.some(h => h in answers)) return [];
  const lines: string[] = [];
  let component = item.component;
  const chosen = answers[COMPONENT_HEADING];
  const labelled = item.labels.some(l => l.startsWith(config.componentLabelPrefix));
  if (chosen && config.boards[chosen] && !labelled) {
    await backlog.api.addLabels(number, [componentLabel(config, chosen)]);
    lines.push(`#${number} component ${chosen}`);
    component = chosen;
  }
  if (!config.boards[component]) return lines; // no board for its component: like the sweep, left alone
  const values: Omit<FieldValues, "status"> = {
    priority: optionKey(f.priority, answers[f.priority.name]),
    role: optionKey(f.role, answers[f.role.name]),
    effort: optionKey(f.effort, answers[f.effort.name]),
  };
  const outcome = await backlog.update(number, values);
  if (outcome.changed) lines.push(`#${number} ${outcome.actions.join("; ")}`);
  const decision = config.types.find(t => t.toLowerCase() === "decision");
  if (decision && outcome.item.type === decision && outcome.item.status === "open") {
    await backlog.setStatus(number, "needs-decision");
    lines.push(`#${number} needs-decision`);
  }
  return lines;
}

/** The hidden marker of plan-me's issue-check comment: one per issue, updated in place. */
export const CHECK_COMMENT_MARKER = "<!-- plan-me:issue-check -->";

/** The text of the issue-check comment: the problems and how to fix them, or that they are resolved. */
export function checkComment(report: IssueReport | undefined, type: string | undefined): string {
  if (!report) {
    return `${CHECK_COMMENT_MARKER}\n**plan-me issue check: resolved.** The issue now passes the check.\n`;
  }
  const errors = problemLines(report).filter(l => l.includes(" error: "));
  const warnings = problemLines(report).filter(l => l.includes(" warning: "));
  const list = (lines: string[]): string => lines.map(l => `- ${l}`).join("\n");
  const parts = [
    CHECK_COMMENT_MARKER,
    `**plan-me issue check:** ${report.errors} error(s), ${report.warnings} warning(s). ` +
      "Edit the issue to fix them; this comment follows the edits.",
  ];
  if (errors.length > 0) parts.push(`**Errors** (the issue is not understandable on its own yet):\n${list(errors)}`);
  if (warnings.length > 0) parts.push(`**Warnings:**\n${list(warnings)}`);
  if (report.errors > 0 && type) {
    parts.push(`A ${type} issue has these sections:\n\n\`\`\`markdown\n${skeletonFor(type)}\n\`\`\``);
  }
  return `${parts.join("\n\n")}\n`;
}

/** What the issue check of an issue event found, and what it changed. */
export interface IssueCheckOutcome {
  report: IssueReport;
  lines: string[];
}

/**
 * An issue was opened or edited: runs the issue check on its title, type and body. Problems (errors or warnings):
 * one comment listing them (created once, then updated in place on later edits) and the label, when one is given.
 * Once the issue passes, the comment says the problems are resolved and the label is removed. Idempotent.
 */
export async function onIssueText(
  backlog: Backlog,
  number: number,
  options: IssueCheckOptions & { label?: string }
): Promise<IssueCheckOutcome> {
  const item = await backlog.show(number);
  const report = await checkIssue({ title: item.title, type: item.type, body: item.body }, backlog.config, options);
  const lines: string[] = [];
  const failing = report.errors > 0 || report.warnings > 0;
  const comments = await backlog.api.listComments(number);
  const mine = comments.find(c => c.body.includes(CHECK_COMMENT_MARKER));
  const text = checkComment(failing ? report : undefined, item.type);
  if (mine && mine.body !== text) {
    await backlog.api.updateComment(mine.id, text);
    lines.push(`#${number} issue check comment ${failing ? "updated" : "resolved"}`);
  } else if (!mine && failing) {
    await backlog.api.comment(number, text);
    lines.push(`#${number} issue check comment`);
  }
  if (options.label) {
    const has = item.labels.includes(options.label);
    if (report.errors > 0 && !has) {
      await backlog.api.addLabels(number, [options.label]);
      lines.push(`#${number} label ${options.label}`);
    } else if (report.errors === 0 && has) {
      await backlog.api.removeLabel(number, options.label);
      lines.push(`#${number} label ${options.label} removed`);
    }
  }
  return { report, lines };
}
