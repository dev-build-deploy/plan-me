/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import fs from "fs";
import path from "path";

import { parseFrontMatter } from "./importer";
import { licenseHeader } from "./license";

/** The states a decision can be in: still valid, valid but changed by a later one, or replaced (history only). */
export const DECISION_STATUSES = ["current", "amended", "superseded"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

/**
 * A decision set: the folder with one file per decision and the generated index. Every repository has exactly one,
 * at the defaults (DEFAULT_DECISIONS); the functions take it as a parameter so a second set can be added later.
 */
export interface DecisionSet {
  /** The folder with the decision files, relative to the repository root. */
  dir: string;
  /** The generated index file, relative to the repository root. */
  index: string;
}

/** The one decision set every repository gets, with no configuration. */
export const DEFAULT_DECISIONS: DecisionSet = { dir: "docs/decisions", index: "docs/decisions.md" };

/** One decision: its front matter, its title (the `# heading`) and its full text. */
export interface Decision {
  /** Unique slug; the file is `<date>-<id>.md`. */
  id: string;
  /** Only for decisions imported from a numbered list: the original label (`129`, `L99`). */
  number?: string;
  /** `YYYY-MM-DD`. */
  date: string;
  /** Who decided (`the user`, `the owner`, a name). */
  by: string;
  status: DecisionStatus;
  /** The id of the decision that replaces (superseded) or changes (amended) this one. */
  supersededBy?: string;
  scope: string[];
  /** One line. */
  summary: string;
  /** The question issue it answered (`#12`). */
  question?: string;
  title: string;
  /** The decision in full (markdown, after the title). */
  text: string;
  /** The SPDX header (an HTML comment) between the front matter and the title, if any. */
  license?: string;
}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER = /^[A-Za-z]*\d+$/;
const QUESTION = /^#\d+$/;
/** An SPDX header comment right after the front matter. */
const LICENSE_COMMENT = /^\s*(<!--\s*\n(?:SPDX-[^\n]*\n)+-->)[ \t]*\r?\n?/;
/** The longest slug made from a title, in words. */
const SLUG_WORDS = 6;

/** Words a slug never ends on (dropped after the cut), so ids don't stop mid-phrase. */
const SLUG_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "its",
  "of",
  "on",
  "or",
  "than",
  "that",
  "the",
  "their",
  "to",
  "was",
  "were",
  "with",
]);

/**
 * A slug from free text: lowercase ASCII words joined by `-`, the first SLUG_WORDS words without the stop words that
 * end the cut and without a leading `the` (`decision` if empty). Deterministic; stop words in the middle stay.
 * @example slugify("The report is built from the nightly data") === "report-is-built"
 */
export function slugify(text: string): string {
  const words = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, SLUG_WORDS);
  let end = words.length;
  while (end > 0 && SLUG_STOP_WORDS.has(words[end - 1])) end--;
  const start = words[0] === "the" && end > 1 ? 1 : 0;
  // Only stop words: keep them rather than lose the title.
  const kept = end > start ? words.slice(start, end) : words;
  return kept.join("-") || "decision";
}

/** The file name of a decision: `<date>-<id>.md`. */
export function decisionFileName(d: Pick<Decision, "date" | "id">): string {
  return `${d.date}-${d.id}.md`;
}

/** Today's local date as `YYYY-MM-DD`. */
export function today(now: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The decision file's text: fixed front matter (always the same keys, in the same order), the title, the text. */
export function formatDecision(d: Decision): string {
  const q = (s: string): string => JSON.stringify(s);
  const lines = [
    "---",
    `id: ${d.id}`,
    `number: ${d.number ?? ""}`.trimEnd(),
    `date: ${d.date}`,
    `by: ${q(d.by)}`,
    `status: ${d.status}`,
    `superseded_by: ${d.supersededBy ?? ""}`.trimEnd(),
    `scope: [${d.scope.join(", ")}]`,
    `summary: ${q(d.summary)}`,
    `question: ${d.question ? q(d.question) : ""}`.trimEnd(),
    "---",
    "",
    ...(d.license ? [d.license, ""] : []),
    `# ${d.title}`,
    "",
    d.text.trim(),
    "",
  ];
  return lines.join("\n");
}

function str(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v.join(", ") : v;
  return s && s.trim() ? s.trim() : undefined;
}

/**
 * Parses a decision file. Returns the decision and the problems found (empty when valid).
 * @param file The file's path (for messages and the name check)
 */
export function parseDecision(file: string, content: string): { decision: Decision; problems: string[] } {
  const { data, content: body } = parseFrontMatter(content);
  const header = LICENSE_COMMENT.exec(body);
  const rest = header ? body.slice(header[0].length) : body;
  const problems: string[] = [];
  const heading = /^\s*#\s+(.+)\r?\n?/.exec(rest);
  const scope = data.scope === undefined ? [] : Array.isArray(data.scope) ? data.scope : [data.scope];
  const decision: Decision = {
    id: str(data.id) ?? "",
    number: str(data.number),
    date: str(data.date) ?? "",
    by: str(data.by) ?? "",
    status: (str(data.status) ?? "") as DecisionStatus,
    supersededBy: str(data.superseded_by),
    scope: scope.map(s => s.trim()).filter(Boolean),
    summary: str(data.summary) ?? "",
    question: str(data.question),
    title: heading ? heading[1].trim() : "",
    text: (heading ? rest.slice(heading.index + heading[0].length) : rest).trim(),
    license: header?.[1],
  };
  const bad = (what: string): number => problems.push(`${file}: ${what}`);
  if (!ID.test(decision.id)) bad(`id "${decision.id}" must be a slug (a-z, 0-9, single dashes)`);
  if (!DATE.test(decision.date)) bad(`date "${decision.date}" must be YYYY-MM-DD`);
  if (!decision.by) bad("by is missing");
  if (!(DECISION_STATUSES as readonly string[]).includes(decision.status)) {
    bad(`status "${decision.status}" must be one of ${DECISION_STATUSES.join(", ")}`);
  }
  if (decision.status === "superseded" && !decision.supersededBy) bad("a superseded decision needs superseded_by");
  if (decision.status === "current" && decision.supersededBy) bad("a current decision can't have superseded_by");
  if (!decision.summary || /[\r\n]/.test(decision.summary)) bad("summary must be one line");
  if (decision.number !== undefined && !NUMBER.test(decision.number)) {
    bad(`number "${decision.number}" must be the original label (129, L99)`);
  }
  if (decision.question !== undefined && !QUESTION.test(decision.question)) {
    bad(`question "${decision.question}" must be an issue (#12)`);
  }
  if (!decision.title) bad("the `# title` heading is missing");
  if (problems.length === 0 && path.basename(file) !== decisionFileName(decision)) {
    bad(`the file must be named ${decisionFileName(decision)}`);
  }
  return { decision, problems };
}

/** The decision files of a set (sorted by name) with their parse problems; a missing folder is an empty set. */
export function readDecisions(root: string, set: DecisionSet): { decisions: Decision[]; problems: string[] } {
  const dir = path.join(root, set.dir);
  const decisions: Decision[] = [];
  const problems: string[] = [];
  if (!fs.existsSync(dir)) return { decisions, problems };
  for (const name of fs
    .readdirSync(dir)
    .filter(f => f.endsWith(".md"))
    .sort()) {
    const file = path.posix.join(set.dir, name);
    const parsed = parseDecision(file, fs.readFileSync(path.join(dir, name), "utf8"));
    decisions.push(parsed.decision);
    problems.push(...parsed.problems);
  }
  return { decisions, problems };
}

/** The numeric part of a label (`L99` -> 99), for ordering. */
function labelValue(number: string | undefined): number {
  return number ? +(/\d+/.exec(number)?.[0] ?? 0) : -1;
}

/** Index order within a status: newest date first, then the higher number, then the id. */
function compareDecisions(a: Decision, b: Decision): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  const n = labelValue(b.number) - labelValue(a.number);
  if (n !== 0) return n;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The status column: `current`, `amended`, `amended by <id>` or `superseded by <id>`. */
function statusColumn(d: Decision): string {
  return d.supersededBy && d.status !== "current" ? `${d.status} by ${d.supersededBy}` : d.status;
}

/** One index line: `- <id> · <number or -> · <date> · <status> · <scope or -> · <summary>`. */
export function formatIndexLine(d: Decision): string {
  const scope = d.scope.length > 0 ? d.scope.join(", ") : "-";
  return `- ${d.id} · ${d.number ?? "-"} · ${d.date} · ${statusColumn(d)} · ${scope} · ${d.summary}`;
}

const SECTIONS: [DecisionStatus, string, string][] = [
  ["current", "Current", "Valid: follow these."],
  ["amended", "Amended", "Still valid, but changed by a later decision: read the one named after `amended by` too."],
  ["superseded", "Superseded", "History only: never follow these; follow the decision named after `superseded by`."],
];

/**
 * The index text for a set: a generated-file header, then one line per decision under Current, Amended and
 * Superseded. Deterministic (no timestamps, no counts), so it diffs cleanly and merges line by line.
 * @param license The SPDX header comment, placed after the generated-file comment
 */
export function formatIndex(decisions: Decision[], set: DecisionSet, license?: string): string {
  const out = [
    `<!-- Generated by plan-me from ${set.dir}/: do not edit by hand. Regenerate with \`plan-me decisions index\`. -->`,
    ...(license ? [license] : []),
    "",
    "# Decisions",
    "",
    `One file per decision in [${set.dir}/](${path.posix.relative(path.posix.dirname(set.index), set.dir)}/), named`,
    "`<date>-<id>.md`. One line per decision here, in this format:",
    "",
    "`- <id> · <number or -> · <date> · <status> · <scope or -> · <summary>`",
    "",
    "`number` is only set for decisions imported from an old numbered list (decision 129, L99).",
  ];
  for (const [status, title, help] of SECTIONS) {
    const lines = decisions
      .filter(d => d.status === status)
      .sort(compareDecisions)
      .map(formatIndexLine);
    out.push("", `## ${title}`, "", help, "", ...(lines.length > 0 ? lines : ["(none)"]));
  }
  return out.join("\n") + "\n";
}

/**
 * The SPDX header of a set's index (licenseHeader), dated with the oldest decision's year so the index doesn't change
 * with the calendar.
 */
export function indexLicense(root: string, set: DecisionSet, decisions: Decision[]): string | undefined {
  const years = decisions.map(d => d.date.slice(0, 4)).filter(y => /^\d{4}$/.test(y));
  return licenseHeader(root, set.index, years.sort()[0] ?? today().slice(0, 4));
}

/**
 * Regenerates the index file of a set from its decision files.
 * @returns Whether the file changed
 * @throws When a decision file is invalid (the index is only written from valid files)
 */
export function writeIndex(root: string, set: DecisionSet = DEFAULT_DECISIONS): boolean {
  const { decisions, problems } = readDecisions(root, set);
  if (problems.length > 0) throw new Error(problems.join("\n"));
  const file = path.join(root, set.index);
  const text = formatIndex(decisions, set, indexLicense(root, set, decisions));
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return true;
}

/**
 * Checks a set: every file valid, ids and numbers unique, every superseded_by naming an existing decision, and the
 * index exactly what `decisions index` would write. Returns one line per problem (empty: clean). A repository
 * without the folder doesn't use decisions and passes (its `docs/decisions.md`, if any, is left alone).
 */
export function checkDecisions(root: string, set: DecisionSet = DEFAULT_DECISIONS): string[] {
  if (!fs.existsSync(path.join(root, set.dir))) return []; // no decisions folder: the repository doesn't use them
  const { decisions, problems } = readDecisions(root, set);
  const ids = new Map<string, number>();
  const numbers = new Map<string, number>();
  decisions.forEach(d => ids.set(d.id, (ids.get(d.id) ?? 0) + 1));
  decisions.forEach(d => d.number && numbers.set(d.number, (numbers.get(d.number) ?? 0) + 1));
  for (const [id, n] of ids) if (n > 1 && id) problems.push(`${set.dir}: id "${id}" is used by ${n} decisions`);
  for (const [num, n] of numbers) if (n > 1) problems.push(`${set.dir}: number ${num} is used by ${n} decisions`);
  for (const d of decisions) {
    if (d.supersededBy && !ids.has(d.supersededBy)) {
      problems.push(`${set.dir}/${decisionFileName(d)}: superseded_by "${d.supersededBy}" is no decision`);
    } else if (d.supersededBy === d.id && d.id) {
      problems.push(`${set.dir}/${decisionFileName(d)}: superseded_by points to itself`);
    }
  }
  const file = path.join(root, set.index);
  const want = formatIndex(decisions, set, indexLicense(root, set, decisions));
  if (!fs.existsSync(file)) {
    problems.push(`${set.index}: missing; run \`plan-me decisions index\``);
  } else {
    const have = fs.readFileSync(file, "utf8");
    if (have !== want) {
      const a = have.split("\n");
      const b = want.split("\n");
      const at = a.findIndex((line, i) => line !== b[i]);
      const line = at < 0 ? b.length : at + 1;
      problems.push(
        `${set.index}: stale or edited by hand (line ${line}: expected "${b[line - 1] ?? ""}", found "${a[line - 1] ?? ""}"); run \`plan-me decisions index\``
      );
    }
  }
  return problems;
}

/** The input of `decide` (recording a decision). */
export interface NewDecision {
  text: string;
  title: string;
  by: string;
  /** One line for the index (default: the title). */
  summary?: string;
  scope?: string[];
  /** The question issue it answers (`12` or `#12`). */
  question?: string;
  /** The id of a decision this one replaces: that one becomes superseded. */
  supersedes?: string;
  /** The id of a decision this one changes: that one becomes amended. */
  amends?: string;
  /** `YYYY-MM-DD` (default today). */
  date?: string;
  /** The id (default: the title's slug). */
  id?: string;
}

/** What `decide` did: the new file's path (relative to the root), whether anything changed, the action lines. */
export interface DecisionOutcome {
  path: string;
  decision: Decision;
  changed: boolean;
  actions: string[];
}

/**
 * Writes a decision file, marks the decision it supersedes or amends, and regenerates the index. Idempotent: the
 * same input again changes nothing.
 * @throws When the id is taken by a different decision, the superseded/amended id doesn't exist, or a file is invalid
 */
export function recordDecision(
  root: string,
  input: NewDecision,
  set: DecisionSet = DEFAULT_DECISIONS
): DecisionOutcome {
  const { decisions, problems } = readDecisions(root, set);
  if (problems.length > 0) throw new Error(problems.join("\n"));
  const question = input.question ? `#${String(input.question).replace(/^#/, "")}` : undefined;
  const decision: Decision = {
    id: input.id ?? slugify(input.title),
    date: input.date ?? today(),
    by: input.by,
    status: "current",
    scope: input.scope ?? [],
    summary: (input.summary ?? input.title).replace(/\s+/g, " ").trim(),
    question,
    title: input.title.trim(),
    text: input.text,
  };
  const file = path.posix.join(set.dir, decisionFileName(decision));
  decision.license = licenseHeader(root, file, decision.date.slice(0, 4));
  const content = formatDecision(decision);
  const check = parseDecision(file, content).problems;
  if (check.length > 0) throw new Error(check.join("\n"));
  const actions: string[] = [];
  const existing = decisions.find(d => d.id === decision.id);
  const same = (d: Decision): Decision => ({ ...d, status: "current", supersededBy: undefined, license: undefined });
  if (existing && formatDecision(same(existing)) !== formatDecision(same(decision))) {
    throw new Error(`a decision with id "${decision.id}" exists (${decisionFileName(existing)}): pass another --id`);
  }
  const marks: [string | undefined, DecisionStatus][] = [
    [input.supersedes, "superseded"],
    [input.amends, "amended"],
  ];
  const targets = marks.map(([id, status]) => {
    if (!id) return undefined;
    const target = decisions.find(d => d.id === id);
    if (!target) throw new Error(`no decision with id "${id}"`);
    if (target.id === decision.id) throw new Error("a decision can't replace itself");
    return { target, status };
  });
  if (!existing) {
    fs.mkdirSync(path.join(root, set.dir), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
    actions.push(`wrote ${file}`);
  }
  for (const t of targets) {
    if (!t || (t.target.status === t.status && t.target.supersededBy === decision.id)) continue;
    if (t.target.status === "superseded" && t.status === "amended") continue; // superseded stays superseded
    const updated = { ...t.target, status: t.status, supersededBy: decision.id };
    fs.writeFileSync(path.join(root, set.dir, decisionFileName(updated)), formatDecision(updated));
    actions.push(`${t.target.id} ${t.status} by ${decision.id}`);
  }
  if (writeIndex(root, set)) actions.push(`wrote ${set.index}`);
  return { path: file, decision, changed: actions.length > 0, actions };
}
