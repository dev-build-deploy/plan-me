/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import fs from "fs";
import path from "path";

import {
  Decision,
  decisionFileName,
  DecisionSet,
  DEFAULT_DECISIONS,
  formatDecision,
  readDecisions,
  slugify,
  writeIndex,
} from "./decisions";
import { shortTitle } from "./importer";

/**
 * The numbered-list formats `decisions import` reads:
 * - `numbered`: `129. **Title** (2026-11-01, the user): text`; the date may also come from a `## 2026-10-10` heading.
 * - `labelled`: `- **L99** (2026-10-27) text`.
 * Both continue an entry on indented lines (numbered sub-points included).
 */
export const IMPORT_FORMATS = ["numbered", "labelled"] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

/** One entry of an old list, before it becomes a file. */
export interface ListEntry {
  /** The original label: `129`, `L99`. */
  number: string;
  date: string;
  /** Who decided, when the entry says so (`the user`). */
  by?: string;
  title: string;
  /** The entry's full text as written (without the list marker), continuation lines dedented. */
  text: string;
}

/** Options of `decisions import`. */
export interface DecisionImportOptions {
  /** Who decided, for entries that don't say (default `unknown`). */
  by?: string;
  /** The scope given to every imported decision. */
  scope?: string[];
  dryRun?: boolean;
}

const NUMBERED = /^(\d+)\.\s+(.*)$/;
const LABELLED = /^- \*\*([A-Za-z]*\d+)\*\*\s*(.*)$/;
const DATE_HEADING = /^#{2,}\s+(\d{4}-\d{2}-\d{2})\b/;
const DATE_PAREN = /^\((\d{4}-\d{2}-\d{2})\)\s*/;
/** `the user`, `the owner`, ...: the only `by` an import trusts from the text. */
/** The deciders an import trusts from the text; anything else gets `--by`. */
const BY = /^the (?:user|owner|lead|team)$/i;
const BY_IN_TEXT = /\((the (?:user|owner|lead|team))\b[,:)]/i;
const DEFAULT_BY = "unknown";
/** The start of a `(the user: "...")` remark. */
const REMARK = /\(the (?:user|owner|lead|team)\b/i;

/** Strips a leading `(…)` group with balanced brackets; returns its content and the rest. */
function leadingParen(text: string): { inner?: string; rest: string } {
  if (!text.startsWith("(")) return { rest: text };
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return { inner: text.slice(1, i), rest: text.slice(i + 1).trim() };
  }
  return { rest: text };
}

/** Who decided: a `the user`-like part of the header's parentheses, else the first `(the user…` in the text. */
function findBy(candidate: string | undefined, text: string): string | undefined {
  const head = candidate?.split(/[:,]/)[0].trim();
  if (head && BY.test(head)) return head;
  return BY_IN_TEXT.exec(text.slice(0, 300))?.[1];
}

/** Groups the lines into entries: a start line, then its indented (or blank-then-indented) continuation lines. */
function entries(lines: string[], start: RegExp): { first: RegExpExecArray; body: string[]; date?: string }[] {
  const out: { first: RegExpExecArray; body: string[]; date?: string }[] = [];
  let heading: string | undefined;
  let current: { first: RegExpExecArray; body: string[]; date?: string } | undefined;
  let blanks: string[] = [];
  for (const line of lines) {
    const date = DATE_HEADING.exec(line);
    const m = start.exec(line);
    if (m) {
      current = { first: m, body: [], date: heading };
      out.push(current);
      blanks = [];
    } else if (current && line.trim() === "") {
      blanks.push("");
    } else if (current && /^\s+\S/.test(line)) {
      current.body.push(...blanks, line);
      blanks = [];
    } else {
      current = undefined;
      blanks = [];
      if (date) heading = date[1];
    }
  }
  return out;
}

/** Removes the common indentation of the continuation lines. */
function dedent(lines: string[]): string[] {
  const indents = lines.filter(l => l.trim()).map(l => /^\s*/.exec(l)?.[0].length ?? 0);
  const cut = indents.length > 0 ? Math.min(...indents) : 0;
  return lines.map(l => l.slice(cut));
}

/** Removes the `(the user: "...")` remarks (balanced brackets) from a text. */
function withoutRemarks(text: string): string {
  let out = text;
  for (let at = out.search(/\(the (?:user|owner|lead|team)\b/i); at >= 0;) {
    const { inner } = leadingParen(out.slice(at));
    if (inner === undefined) break;
    out = (out.slice(0, at).trimEnd() + out.slice(at + inner.length + 2)).trim();
    at = out.search(REMARK);
  }
  return out;
}

/** A title from free text: its first sentence (shortTitle) without `(the user...)` remarks or a trailing `(…)`. */
function titleFrom(text: string): string {
  const { rest } = leadingParen(text.replace(/\s+/g, " ").trim());
  const title = withoutRemarks(shortTitle(rest));
  const cut = title.search(REMARK); // a remark the title's length limit cut open
  return (cut >= 0 ? title.slice(0, cut) : title)
    .replace(/\s*\([^()]*\)$/, "")
    .replace(/[:.]$/, "")
    .trim();
}

/**
 * Parses an old numbered list into entries.
 * @throws When an entry has no date (neither in its parentheses nor under a dated heading)
 */
export function parseDecisionList(text: string, format: ImportFormat): ListEntry[] {
  const lines = text.split(/\r?\n/);
  return entries(lines, format === "numbered" ? NUMBERED : LABELLED).map(e => {
    const label = e.first[1];
    const head = e.first[2];
    const full = [head, ...dedent(e.body)].join("\n").trim();
    if (format === "numbered") {
      const bold = /^\*\*(.+?)\*\*\s*(.*)$/.exec(full.replace(/\s+/g, " ")); // title and date may wrap
      const title = (bold ? bold[1] : titleFrom(head)).replace(/[:.]\s*$/, "").trim();
      const { inner } = leadingParen(bold ? bold[2] : "");
      const dated = inner ? /^(\d{4}-\d{2}-\d{2})(?:,\s*(.*))?$/s.exec(inner) : null;
      const date = dated?.[1] ?? e.date;
      if (!date) throw new Error(`decision ${label}: no date (in its parentheses or a "## YYYY-MM-DD" heading)`);
      return { number: label, date, by: findBy(dated?.[2], full), title, text: full };
    }
    const dated = DATE_PAREN.exec(head);
    const date = dated?.[1] ?? e.date;
    if (!date) throw new Error(`decision ${label}: no date (in its parentheses or a "## YYYY-MM-DD" heading)`);
    const body = dated ? [head.slice(dated[0].length), ...dedent(e.body)].join("\n").trim() : full;
    return { number: label, date, by: findBy(undefined, body), title: titleFrom(body), text: full };
  });
}

/** A reference list (`L1, L31 and L5`) in a format's spelling; `decision 42` or a bare number for numbered lists. */
function refList(ref: string): string {
  return `(${ref}(?:\\s*(?:,|and|&|/)\\s*${ref})*)`;
}

/** The patterns that state a change, per format; their first non-empty group holds the reference list. */
function changePatterns(format: ImportFormat): { direct: RegExp; partial: RegExp } {
  const label = "L\\d+(?![\\w-])";
  const num = "(?:decisions?\\s+)?\\d+(?![\\w-])";
  const refs = refList(format === "labelled" ? label : num);
  const verb = "(?:[Ss]upersedes|[Rr]eplaces)";
  const amendVerb = "(?:[Rr]efines|[Aa]mends)";
  if (format === "labelled") {
    return {
      direct: new RegExp(`${verb}\\s+${refs}(?!['’]s)`, "g"),
      partial: new RegExp(`(?:\\b(?:in|of)\\s+|${amendVerb}\\s+)${refs}|(${label})['’]s\\b`, "g"),
    };
  }
  const named = `decisions?\\s+${refList("\\d+(?![\\w-])")}`;
  return {
    direct: new RegExp(`${verb}\\s+${refs}(?!['’]s)`, "g"),
    partial: new RegExp(`\\b(?:in|of)\\s+${named}|${amendVerb}\\s+${refs}|(decisions?\\s+\\d+)['’]s\\b`, "g"),
  };
}

/** The labels in a matched reference list (`decision 42 and 43` -> 42, 43; `L1, L31` -> L1, L31). */
function labels(match: RegExpMatchArray): string[] {
  const list = match.slice(1).find(g => g !== undefined) ?? "";
  return [...list.matchAll(/L\d+|\d+/g)].map(m => m[0]);
}

const CHANGE_WORDS = /\b(?:supersed|replac|refine|amend)/i;

/**
 * The changes an entry states, deterministic and conservative, in sentences (split at `.` and `;`) with
 * supersede/replace/refine/amend: `Supersedes L3` / `replaces 9` (the reference right after the verb) supersedes it;
 * `refines L50`, `... in L3`, `of L65`, `L96's ...` (numbered lists: `in decision 42`, `decision 42's`) amends it.
 * The caller applies only references to earlier entries.
 */
export function findChanges(entry: ListEntry, format: ImportFormat): { superseded: string[]; amended: string[] } {
  const superseded = new Set<string>();
  const amended = new Set<string>();
  const { direct, partial } = changePatterns(format);
  for (const sentence of entry.text.replace(/\s+/g, " ").split(/[.;](?:\s|$)/)) {
    if (!CHANGE_WORDS.test(sentence)) continue;
    for (const m of sentence.matchAll(direct)) labels(m).forEach(l => superseded.add(l));
    for (const m of sentence.matchAll(partial)) labels(m).forEach(l => superseded.has(l) || amended.add(l));
  }
  return { superseded: [...superseded], amended: [...amended] };
}

/**
 * Converts the entries into decisions: ids from the titles (made unique with the label, e.g. `-l99`, when two
 * entries or an existing file share a slug), the stated supersessions applied to the earlier entries.
 */
export function toDecisions(
  list: ListEntry[],
  format: ImportFormat,
  options: DecisionImportOptions = {},
  takenIds: string[] = []
): Decision[] {
  const slugs = list.map(e => slugify(e.title));
  const count = new Map<string, number>();
  [...slugs, ...takenIds].forEach(s => count.set(s, (count.get(s) ?? 0) + 1));
  const decisions: Decision[] = list.map((e, i) => ({
    id: (count.get(slugs[i]) ?? 0) > 1 ? `${slugs[i]}-${e.number.toLowerCase()}` : slugs[i],
    number: e.number,
    date: e.date,
    by: e.by ?? options.by ?? DEFAULT_BY,
    status: "current",
    scope: options.scope ?? [],
    summary: e.title,
    title: e.title,
    text: e.text,
  }));
  const index = new Map(list.map((e, i) => [e.number.toUpperCase(), i]));
  list.forEach((e, i) => {
    const { superseded, amended } = findChanges(e, format);
    const mark = (ref: string, status: "superseded" | "amended"): void => {
      const j = index.get(ref);
      if (j === undefined || j >= i) return;
      const old = decisions[j];
      if (old.status === "superseded" && status === "amended") return;
      decisions[j] = { ...old, status, supersededBy: decisions[i].id };
    };
    superseded.forEach(r => mark(r, "superseded"));
    amended.forEach(r => mark(r, "amended"));
  });
  return decisions;
}

/**
 * `decisions import`: converts an old numbered list into one file per decision (keeping the labels as `number`),
 * then regenerates the index. Rerunnable: entries whose number already has a file are skipped.
 * @returns One line per action (`wrote ...`, `exists 129 ...`, `wrote docs/decisions.md`)
 */
export function importDecisions(
  root: string,
  file: string,
  format: ImportFormat,
  options: DecisionImportOptions = {},
  set: DecisionSet = DEFAULT_DECISIONS
): string[] {
  if (!IMPORT_FORMATS.includes(format))
    throw new Error(`unknown format "${format}" (one of: ${IMPORT_FORMATS.join(", ")})`);
  const { decisions: existing, problems } = readDecisions(root, set);
  if (problems.length > 0) throw new Error(problems.join("\n"));
  const byNumber = new Map(existing.filter(d => d.number).map(d => [d.number, d]));
  const list = parseDecisionList(fs.readFileSync(path.resolve(root, file), "utf8"), format);
  const fresh = list.filter(e => !byNumber.has(e.number));
  const taken = existing.map(d => d.id);
  const all = toDecisions(
    list,
    format,
    options,
    taken.filter(id => !list.some(e => byNumber.get(e.number)?.id === id))
  );
  const lines: string[] = [];
  for (const [i, e] of list.entries()) {
    const d = all[i];
    const have = byNumber.get(e.number);
    if (have) {
      lines.push(`exists ${e.number} ${set.dir}/${decisionFileName(have)}`);
      continue;
    }
    const target = path.posix.join(set.dir, decisionFileName(d));
    lines.push(
      `${options.dryRun ? "would write" : "wrote"} ${target}${d.status === "current" ? "" : ` (${d.status} by ${d.supersededBy})`}`
    );
    if (options.dryRun) continue;
    fs.mkdirSync(path.join(root, set.dir), { recursive: true });
    fs.writeFileSync(path.join(root, target), formatDecision(d));
  }
  if (!options.dryRun && fresh.length > 0 && writeIndex(root, set)) lines.push(`wrote ${set.index}`);
  return lines;
}
