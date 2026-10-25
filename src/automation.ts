/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { Backlog } from "./backlog";
import { Item } from "./item";

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
