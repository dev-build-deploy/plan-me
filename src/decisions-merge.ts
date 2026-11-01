/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

import {
  Decision,
  DECISION_STATUSES,
  DecisionSet,
  DecisionStatus,
  DEFAULT_DECISIONS,
  formatIndex,
  indexLicense,
} from "./decisions";

/** The git merge driver's name (`merge=plan-me-decisions` in `.gitattributes`, `merge.plan-me-decisions.*` config). */
export const MERGE_DRIVER = "plan-me-decisions";
/** The command git runs for the driver, unless `install` is given another. */
export const DEFAULT_DRIVER_COMMAND = "plan-me";

const SEPARATOR = " · ";
const LINE = /^- (\S+)$/;

/**
 * Reads the decisions back from an index's lines (`- <id> · <number> · <date> · <status> · <scope> · <summary>`).
 * Only the index fields are filled in (no title or text): enough to write the index again.
 * @throws When a line in a section doesn't have the index format (a hand edit): the merge then stops as a conflict
 */
export function parseIndex(text: string): Decision[] {
  const decisions: Decision[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("- ")) continue;
    const parts = line.slice(2).split(SEPARATOR);
    if (parts.length < 6 || !LINE.test(`- ${parts[0]}`)) throw new Error(`not an index line: "${line}"`);
    const [id, number, date, status, scope] = parts;
    const [word, , by] = status.split(" ");
    if (!(DECISION_STATUSES as readonly string[]).includes(word)) throw new Error(`unknown status in "${line}"`);
    decisions.push({
      id,
      number: number === "-" ? undefined : number,
      date,
      by: "",
      status: word as DecisionStatus,
      supersededBy: by,
      scope: scope === "-" ? [] : scope.split(", "),
      summary: parts.slice(5).join(SEPARATOR),
      title: "",
      text: "",
    });
  }
  return decisions;
}

const RANK: Record<DecisionStatus, number> = { current: 0, amended: 1, superseded: 2 };
const key = (d: Decision | undefined): string => JSON.stringify(d ?? null);

/**
 * Three-way merge of the decisions in two indexes, by id: a side's change (added, changed, removed) wins over the
 * unchanged side; when both changed the same decision differently, the further status wins (superseded over amended
 * over current), then ours.
 */
export function mergeDecisions(base: Decision[], ours: Decision[], theirs: Decision[]): Decision[] {
  const o = new Map(base.map(d => [d.id, d]));
  const a = new Map(ours.map(d => [d.id, d]));
  const b = new Map(theirs.map(d => [d.id, d]));
  const merged: Decision[] = [];
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const [x, y, z] = [o.get(id), a.get(id), b.get(id)];
    let pick: Decision | undefined;
    if (key(y) === key(z) || key(z) === key(x)) pick = y;
    else if (key(y) === key(x)) pick = z;
    else if (!y || !z)
      pick = y ?? z; // removed on one side, changed on the other: keep the change
    else pick = RANK[z.status] > RANK[y.status] ? z : y;
    if (pick) merged.push(pick);
  }
  return merged;
}

/**
 * The git merge driver (`plan-me decisions merge-driver %O %A %B`): instead of merging the generated index as text,
 * it merges the decisions both sides list and writes the index again, in the generator's format, to `ours` (git's
 * %A). The decision files themselves are merged by git as usual (they never overlap: one file per decision), and
 * `decisions check` afterwards compares the index with them. Git runs the driver in the repository root.
 * @returns Whether it merged (false: a side isn't a valid index; git then reports a conflict)
 */
export function runMergeDriver(
  base: string,
  ours: string,
  theirs: string,
  root: string = process.cwd(),
  set: DecisionSet = DEFAULT_DECISIONS
): boolean {
  try {
    const read = (f: string): Decision[] => (fs.existsSync(f) ? parseIndex(fs.readFileSync(f, "utf8")) : []);
    const merged = mergeDecisions(read(base), read(ours), read(theirs));
    fs.writeFileSync(ours, formatIndex(merged, set, indexLicense(root, set, merged)));
    return true;
  } catch (_e) {
    return false;
  }
}

/**
 * `decisions install`: sets up the merge driver for this clone. Writes `<index> merge=plan-me-decisions` to
 * `.gitattributes` (shared, commit it) and the driver to the clone's git config (local, once per clone). Idempotent.
 * @param command How git starts plan-me (default `plan-me`, which must be on the PATH)
 * @returns One line per change (empty: already installed)
 */
export function installMergeDriver(
  root: string,
  command: string = DEFAULT_DRIVER_COMMAND,
  set: DecisionSet = DEFAULT_DECISIONS
): string[] {
  const actions: string[] = [];
  const attributes = path.join(root, ".gitattributes");
  const line = `${set.index} merge=${MERGE_DRIVER}`;
  const text = fs.existsSync(attributes) ? fs.readFileSync(attributes, "utf8") : "";
  if (!text.split(/\r?\n/).some(l => l.trim() === line)) {
    fs.writeFileSync(attributes, `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`);
    actions.push(`.gitattributes: ${line}`);
  }
  const config: [string, string][] = [
    [`merge.${MERGE_DRIVER}.name`, "plan-me: regenerate the decisions index"],
    [`merge.${MERGE_DRIVER}.driver`, `${command} decisions merge-driver %O %A %B`],
  ];
  for (const [name, value] of config) {
    const git = (...args: string[]): string => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    let have = "";
    try {
      have = git("config", "--local", "--get", name);
    } catch (_e) {
      have = "";
    }
    if (have === value) continue;
    git("config", "--local", name, value);
    actions.push(`git config ${name} "${value}"`);
  }
  return actions;
}
