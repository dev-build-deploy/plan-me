/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { Backlog, FieldValues } from "./backlog";
import { componentLabel, SelectField } from "./config";
import { Item } from "./item";
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

/**
 * Keeps the open backlog consistent: a missing Priority gets the default (and a comment), a missing Status becomes
 * open, and blocked items whose blockers are all closed go back to open (with a comment). Idempotent.
 * @param only Restrict to these issue numbers (e.g. the issue of an `issues` event)
 */
export async function sweep(backlog: Backlog, only?: number[]): Promise<string[]> {
  const lines: string[] = [];
  const raws = await backlog.api.listIssues(false);
  const hadBlockers = new Map(raws.map(r => [r.number, r.blockedBy.length > 0]));
  const fieldsOf = new Map(raws.map(r => [r.number, r]));
  const config = backlog.config;
  for (const item of await backlog.list({ state: "open" })) {
    if (only && !only.includes(item.number)) continue;
    if (!config.boards[item.component]) continue;
    if (unblockable(item, hadBlockers.get(item.number) ?? false)) {
      await backlog.setStatus(item.number, "open");
      await backlog.api.comment(item.number, "plan-me: unblocked, all blockers are closed.");
      lines.push(`#${item.number} unblocked`);
    }
    const raw = fieldsOf.get(item.number);
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
  }
  return lines;
}

/** An issue was closed: its status becomes done, and its dependents are unblocked when free. */
export async function onIssueClosed(backlog: Backlog, number: number): Promise<string[]> {
  const lines: string[] = [];
  const outcome = await backlog.done(number);
  if (outcome.changed) lines.push(`#${number} done`);
  return [...lines, ...(await sweep(backlog))];
}

/** The option key for a form answer (an option name or key); free text for a field without options. */
function optionKey(field: SelectField, answer: string | undefined): string | undefined {
  if (answer === undefined) return undefined;
  const options = Object.entries(field.options);
  if (options.length === 0) return answer;
  return options.find(([key, name]) => name === answer || key === answer)?.[0];
}

/**
 * An issue was opened from one of plan-me's issue forms: its answers become the board fields and labels. The
 * Component answer adds the component label (unless the issue already has one); Priority, Role and Size (the
 * configured field names) set the board fields; a Decision opens as needs-decision. An issue without form answers
 * (opened by `new`, or a blank issue) is left to the sweep. Returns one line per change.
 */
export async function onIssueOpened(backlog: Backlog, number: number): Promise<string[]> {
  const config = backlog.config;
  const item = await backlog.show(number);
  const answers = parseFormAnswers(item.body);
  const f = config.fields;
  const headings = [COMPONENT_HEADING, f.priority.name, f.role.name, f.size.name];
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
    size: optionKey(f.size, answers[f.size.name]),
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
