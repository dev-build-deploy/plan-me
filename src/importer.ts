/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import fs from "fs";
import path from "path";

import { RawIssue } from "./api";
import { Backlog, NewItem } from "./backlog";
import { Config, Status, STATUSES, typeLabel } from "./config";
import { appendLine, BLOCKED_BY_LINE, PARENT_LINE, TASK_LIST_LINE } from "./github";
import { checkIssues, IssueCheckOptions, IssueReport, problemLines } from "./issue-check";
import { MARKER, typeOf } from "./item";
import { sectionsFor } from "./templates";

/** One item read from a markdown backlog, before it becomes an issue. */
export interface ImportRecord {
  id: string;
  title: string;
  body: string;
  type?: string;
  status: Status;
  priority?: string;
  component?: string;
  role?: string;
  /** The parent's id. */
  parent?: string;
  /** The ids of the items this one depends on (its blockers). */
  dependsOn: string[];
  /** Problems found while reading it (an import prints them as `warn` lines). */
  warnings?: string[];
  design: string[];
  source: string;
}

/** Options shared by the adapters and the import run. */
export interface ImportOptions {
  /** The component for records whose area names none. */
  component?: string;
  /** Prefix for design doc paths given relative to the docs folder (default `docs/`). */
  designPrefix?: string;
  /** Done items: skip them (default) or import them closed. */
  done?: "skip" | "closed";
  dryRun?: boolean;
  /** Rewrite the issues that exist already (by id) when their title, body, type or fields differ from the record. */
  update?: boolean;
  /** How the issue check runs (default: the real Vale, the glossary in the working directory). */
  check?: IssueCheckOptions;
}

/** The section headings of a type written as `## X` in an item file: plan-me writes them as `### X`, like the forms. */
function sectionHeadings(text: string, type: string | undefined): string {
  if (!type) return text;
  const labels = new Set(sectionsFor(type).map(s => s.label.toLowerCase()));
  return text.replace(/^##[ \t]+(.+?)[ \t]*$/gm, (line, label: string) =>
    labels.has(label.replace(/:$/, "").toLowerCase()) ? `### ${label}` : line
  );
}

const TITLE_MAX = 100;
const TITLE_MIN_CLAUSE = 30;
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
/** A whole quoted scalar: a JSON-style double-quoted string (escapes allowed) or a single-quoted one; a comment may follow. */
const QUOTED = /^(?:"((?:[^"\\]|\\.)*)"|'([^']*)')(?:\s+#.*)?$/;

/** Parses the flat YAML front matter plan-me reads (`key: value`, `key: [a, b]`, quoted strings; `#` inside quotes is text). */
export function parseFrontMatter(text: string): { data: Record<string, string | string[]>; content: string } {
  const m = FRONT_MATTER.exec(text);
  if (!m) return { data: {}, content: text };
  const data: Record<string, string | string[]> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*?)\s*$/.exec(line);
    if (!kv) continue;
    const quoted = QUOTED.exec(kv[2]);
    if (quoted) {
      data[kv[1]] = quoted[1] !== undefined ? JSON.parse(`"${quoted[1]}"`) : quoted[2];
      continue;
    }
    const value = kv[2].replace(/\s+#.*$/, "");
    if (/^\[.*\]$/.test(value)) {
      data[kv[1]] = value
        .slice(1, -1)
        .split(",")
        .map(v => unquote(v.trim()))
        .filter(Boolean);
    } else {
      data[kv[1]] = unquote(value);
    }
  }
  return { data, content: text.slice(m[0].length) };
}

function unquote(v: string): string {
  return /^(["']).*\1$/.test(v) && v.length >= 2 ? v.slice(1, -1) : v;
}

function asList(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return (Array.isArray(v) ? v : v.split(/[,\s]+/)).map(s => s.trim()).filter(Boolean);
}

function asString(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v.join(", ") : v;
  return s && s.trim() ? s.trim() : undefined;
}

/** The configured type for a markdown type (`feature` -> Feature); unknown types (chore, art) become Task. */
function mapType(config: Config, type: string | undefined): string | undefined {
  if (!type) return undefined;
  return config.types.find(t => t.toLowerCase() === type.toLowerCase()) ?? "Task";
}

/** The component from an `area` list: the first area (or its first path segment) that names a board. */
function mapComponent(config: Config, areas: string[], fallback?: string): string | undefined {
  for (const area of areas) {
    for (const candidate of [area, area.split("/")[0]]) if (config.boards[candidate]) return candidate;
  }
  return fallback;
}

/**
 * A short title from free text: up to the first sentence end (`.`, or `?` and `!`, which stay; or a colon after at
 * least TITLE_MIN_CLAUSE characters), outside brackets and quotes, cut at a word boundary.
 */
export function shortTitle(text: string): string {
  let depth = 0;
  let quoted = false;
  let end = text.length;
  for (let i = 0; i < text.length - 1; i++) {
    const c = text[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth = Math.max(0, depth - 1);
    else if (c === '"') quoted = !quoted;
    const breaks = text[i + 1] === " " && (".?!".includes(c) || (c === ":" && i >= TITLE_MIN_CLAUSE));
    if (breaks && depth === 0 && !quoted) {
      end = "?!".includes(c) ? i + 1 : i;
      break;
    }
  }
  const first = text.slice(0, end).trim().replace(/\.$/, "");
  if (first.length <= TITLE_MAX) return first;
  return first.slice(0, TITLE_MAX).replace(/\s+\S*$/, "") + "…";
}

/**
 * Adapter (a): a folder of markdown item files with front matter (id, type, parent, title, status, priority, area,
 * owner, agent, decisions, design, depends_on). Files without an `id` are skipped.
 */
export function readItemFolder(config: Config, dir: string, options: ImportOptions = {}): ImportRecord[] {
  const records: ImportRecord[] = [];
  for (const file of fs
    .readdirSync(dir)
    .filter(f => f.endsWith(".md"))
    .sort()) {
    const source = path.join(dir, file);
    const { data, content } = parseFrontMatter(fs.readFileSync(source, "utf8"));
    const id = asString(data.id);
    if (!id) continue;
    const status = asString(data.status) as Status | undefined;
    const title = asString(data.title) ?? id;
    const decisions = asString(data.decisions);
    const type = mapType(config, asString(data.type));
    const body = [
      sectionHeadings(content.replace(/^\s*#\s+.*\r?\n/, "").trim(), type),
      decisions ? `Decisions: ${decisions}` : "",
      asString(data.owner) ? `Owner: ${asString(data.owner)}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    records.push({
      id,
      title,
      body,
      type,
      status: status && STATUSES.includes(status) ? status : "open",
      priority: asString(data.priority),
      component: mapComponent(config, asList(data.area), options.component),
      role: asString(data.agent) ?? asString(data.owner),
      parent: asString(data.parent),
      dependsOn: asList(data.depends_on),
      design: asList(data.design).map(d => (/^https?:|^docs\//.test(d) ? d : (options.designPrefix ?? "docs/") + d)),
      source,
    });
  }
  return records;
}

/** A separator between a line-list item's id (or its meta, or a status phrase) and its text. */
const SEPARATOR = /^[·:.–—-]\s*/;
/** Further ids joined to a line-list item's id: `+ **other-id**`. */
const JOINED_IDS = /^(?:\+\s*\*\*[\w.-]+\*\*\s*)+/;

/** An id named in a line list's text (no trailing dot, so a sentence end is not part of it). */
const NAMED_ID = String.raw`[\w-]+(?:\.[\w-]+)*`;
/** A list of named ids: `a`, `a, b`, `a and b`. */
const NAMED_IDS = String.raw`${NAMED_ID}(?:\s*(?:,|\band\b)\s*${NAMED_ID})*`;
/** The leading status phrases of a line-list item, and the status each one sets. */
const STATUS_PHRASES: [RegExp, Status][] = [
  [/^In progress\b/i, "in-progress"],
  [/^Needs (?:a )?decision\b/i, "needs-decision"],
  // "Blocked by ..." up to its sentence end or colon (a dot inside a name, as in `v2.1`, does not end it)
  [/^Blocked\b(?:\s+by\s(?:[^.:]|\.(?=\S))*)?/i, "blocked"],
];

/** The status a leading phrase sets ("In progress", "Needs a decision", "Blocked by x"), and the text after it. */
function leadingStatus(text: string): { status?: Status; rest: string } {
  for (const [phrase, status] of STATUS_PHRASES) {
    const m = phrase.exec(text);
    if (m) return { status, rest: skipLead(text.slice(m[0].length)) };
  }
  return { rest: text };
}

/** The start of a leading `After <id>[, <id>] (...):` clause: the items this one comes after. */
const AFTER_CLAUSE = new RegExp(String.raw`^After\s+(${NAMED_IDS})`, "i");
/** `After <id>` anywhere in the text (only known ids count: "after" is a common word). */
const AFTER_PHRASE = new RegExp(String.raw`\bAfter\s+(${NAMED_IDS})`, "gi");
/** `Blocked by <id>[, <id>]` or `Depends on <id>[, <id>]` anywhere in the text. */
const DEPENDENCY_PHRASE = new RegExp(String.raw`\b(?:Blocked by|Depends on)\s+(${NAMED_IDS})`, "gi");

/** The names in a list of named ids (`a, b and c`). */
function splitNames(list: string): string[] {
  return list.split(/\s*(?:,|\band\b)\s*/).filter(Boolean);
}

/** Whether a name reads as an item id (`export-csv`, `v2.1`) rather than a plain word ("the", "design"). */
function looksLikeId(name: string): boolean {
  return /[-_.\d]/.test(name);
}

/**
 * A leading `After <id>[, <id>]:` clause (a `(...)` group may come before the colon): its names, and the text
 * without it (the next word capitalised). A clause naming no id (`After lunch:`) is plain text.
 */
function afterClause(text: string, known: Set<string>): { names: string[]; rest: string } {
  const after = AFTER_CLAUSE.exec(text);
  if (!after) return { names: [], rest: text };
  const tail = skipMeta(text.slice(after[0].length).trim()).trim();
  const names = splitNames(after[1]);
  if (!tail.startsWith(":") || !names.some(n => known.has(n) || looksLikeId(n))) return { names: [], rest: text };
  const rest = tail.slice(1).trim();
  return { names, rest: rest.charAt(0).toUpperCase() + rest.slice(1) };
}

/**
 * The dependencies among the names: the known ids (those defined in the same file), the item's own id left out. An
 * unknown name that looks like an id is a warning, a plain word ("the new API") is ignored.
 */
function resolveNames(id: string, names: string[], known: Set<string>): { dependsOn: string[]; warnings: string[] } {
  const dependsOn: string[] = [];
  const warnings: string[] = [];
  for (const name of new Set(names)) {
    if (name === id) continue;
    if (known.has(name)) dependsOn.push(name);
    else if (looksLikeId(name)) warnings.push(`depends on "${name}", not an item in this file`);
  }
  return { dependsOn, warnings };
}

/** The text after a leading balanced `(...)` group (brackets may nest); the text itself when there is none. */
function skipMeta(text: string): string {
  if (!text.startsWith("(")) return text;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return text.slice(i + 1);
  }
  return text;
}

/** The text without a leading `(meta)` group and the separator after it. */
function skipLead(text: string): string {
  return skipMeta(text.trim()).trim().replace(SEPARATOR, "").trim();
}

/** An item's own priority: a leading priority option (`P3 · text`, `P3 (meta): text`), and the text after it. */
function leadingPriority(text: string, priorities: string[]): { priority?: string; rest: string } {
  const m = /^([\w-]+)(?=[\s(·:.–—-]|$)/.exec(text);
  if (!m || !priorities.includes(m[1])) return { rest: text };
  return { priority: m[1], rest: skipLead(text.slice(m[0].length)) };
}

/** A line-list item as read, before its dependencies are known. */
interface LineItem {
  id: string;
  text: string[];
  done: boolean;
  priority?: string;
}

/**
 * The record for a line-list item; `known` are the ids defined in the same file, `priorities` the configured
 * priority options (a leading one overrides the section's priority).
 */
function lineRecord(
  item: LineItem,
  known: Set<string>,
  priorities: string[],
  file: string,
  options: ImportOptions
): ImportRecord {
  const body = item.text.join(" ").replace(/\s+/g, " ").trim().replace(SEPARATOR, "");
  const own = leadingPriority(skipLead(body.replace(JOINED_IDS, "").replace(/^done\b/i, "")), priorities);
  const text = own.rest;
  const { status, rest } = leadingStatus(text);
  const after = afterClause(rest, known);
  const phrases = [...text.matchAll(DEPENDENCY_PHRASE)].flatMap(m => splitNames(m[1]));
  const later = [...text.matchAll(AFTER_PHRASE)].flatMap(m => splitNames(m[1])).filter(n => known.has(n));
  const deps = resolveNames(item.id, [...after.names, ...phrases, ...later], known);
  return {
    id: item.id,
    title: shortTitle(after.rest || item.id),
    // A line holds one text: it is the What; the other sections are missing, so the issue check refuses the record
    // until the list carries them (or the items move to a folder of item files).
    body: `### What\n\n${body}`,
    status: item.done ? "done" : (status ?? "open"),
    priority: own.priority ?? item.priority,
    component: options.component,
    role: /Helper: ([\w-]+)\.?\s*$/.exec(text)?.[1],
    dependsOn: deps.dependsOn,
    warnings: deps.warnings,
    design: [],
    source: file,
  };
}

/**
 * Adapter (b): a markdown line list. `## P1` headings set the priority (a leading `P3 ·` in an item's text overrides
 * it, left out of the title); a `## Done` heading marks the items under it
 * done (until the next priority heading); `- **id** · text. Helper: role.` starts an item (indented lines continue
 * it). After the id may come joined ids (`+ **other-id**`, the first id is the item), a balanced `(meta)` group
 * (kept in the body, not the title) and a `·`, `-` or `:` separator. `- ~~id~~ done ...` is a done item. A leading
 * "In progress", "Needs (a) decision" or "Blocked (by x)" sets the status and is left out of the title, as is a
 * leading `After <id>[, <id>] (...):` clause. Dependencies: the ids defined in the same file named in that clause
 * or after "Blocked by" / "Depends on" (an unknown id is a warning), or after "After" anywhere else (known ids only).
 */
export function readLineList(config: Config, file: string, options: ImportOptions = {}): ImportRecord[] {
  const items: LineItem[] = [];
  const priorities = Object.keys(config.fields.priority.options);
  let priority: string | undefined;
  let doneSection = false;
  let current: LineItem | undefined;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const heading = /^##\s+(\S+)/.exec(line);
    if (heading) {
      current = undefined;
      if (priorities.includes(heading[1])) {
        priority = heading[1];
        doneSection = false;
      } else if (/^done\b/i.test(heading[1])) {
        doneSection = true;
      }
      continue;
    }
    const open = /^- \*\*([\w.-]+)\*\*\s*(.*)$/.exec(line);
    const done = /^- ~~([\w.-]+)~~\s*(.*)$/.exec(line);
    if (open || done) {
      const m = (open ?? done) as RegExpExecArray;
      current = { id: m[1], text: [m[2]], done: !!done || doneSection, priority };
      items.push(current);
    } else if (current && /^\s+\S/.test(line)) {
      current.text.push(line.trim());
    } else if (line.trim() === "" || /^\S/.test(line)) {
      current = undefined;
    }
  }
  const known = new Set(items.map(i => i.id));
  return items.map(item => lineRecord(item, known, priorities, file, options));
}

/** The `new` input for a record. */
function newItemOf(r: ImportRecord): NewItem {
  return {
    id: r.id,
    title: r.title,
    body: `${r.body}\n\n_Imported from ${r.source}_`,
    type: r.type,
    priority: r.priority,
    component: r.component,
    role: r.role,
    design: r.design,
  };
}

/** The lines plan-me (or a pull request) adds to a body after it is created: kept when `--update` rewrites it. */
function isAddedLine(line: string): boolean {
  const t = line.trim();
  const re = (r: RegExp): boolean => new RegExp(r.source, r.flags.replace("g", "")).test(t);
  return re(PARENT_LINE) || re(BLOCKED_BY_LINE) || re(TASK_LIST_LINE) || /^(?:Branch|Decision): \S/.test(t);
}

/** The body `--update` writes: the record's, plus the lines added to the issue since. */
export function updatedBody(wanted: string, current: string): string {
  const added = current.split(/\r?\n/).filter(isAddedLine);
  let body = wanted;
  for (const line of added) body = appendLine(body, line.trim());
  return body;
}

/** What `--update` would change on an existing issue: title, body, type. */
function differences(backlog: Backlog, raw: RawIssue, item: NewItem, body: string): string[] {
  const out: string[] = [];
  if (raw.title !== item.title) out.push("title");
  if (raw.body.trim() !== body.trim()) out.push("body");
  const current = typeOf(backlog.config, raw);
  if (item.type && current?.toLowerCase() !== item.type.toLowerCase()) out.push("type");
  return out;
}

/** Rewrites an existing issue to its record: title, body, type (issue type or label), priority and role. */
async function updateIssue(backlog: Backlog, raw: RawIssue, item: NewItem, body: string): Promise<string[]> {
  const changes = differences(backlog, raw, item, body);
  const { issueTypes } = await backlog.api.features();
  const native = item.type ? issueTypes.find(t => t.toLowerCase() === item.type?.toLowerCase()) : undefined;
  if (changes.includes("title") || changes.includes("body") || (changes.includes("type") && native)) {
    await backlog.api.updateIssue(raw.number, {
      ...(changes.includes("title") ? { title: item.title } : {}),
      ...(changes.includes("body") ? { body } : {}),
      ...(changes.includes("type") && native ? { issueType: native } : {}),
    });
  }
  if (changes.includes("type") && !native && item.type) {
    const config = backlog.config;
    for (const label of raw.labels.filter(l => l.startsWith(config.typeLabelPrefix))) {
      await backlog.api.removeLabel(raw.number, label);
    }
    await backlog.api.addLabels(raw.number, [typeLabel(config, item.type)]);
  }
  const fields = await backlog.update(raw.number, { priority: item.priority, role: item.role });
  return [...changes, ...fields.actions];
}

/** The `refuse` line and the problems of a record that fails the issue check. */
function refusal(r: ImportRecord, report: IssueReport): string[] {
  return [`refuse ${r.id}: ${report.errors} error(s)`, ...problemLines(report).map(l => `  ${l}`)];
}

/** The warnings of a record that passes, as `warn` lines. */
function warnings(r: ImportRecord, report: IssueReport): string[] {
  return problemLines(report)
    .filter(l => l.includes(" warning: "))
    .map(l => `warn ${r.id}: ${l}`);
}

/**
 * Creates the issues for the records (idempotent through the hidden id marker), then resolves parents and
 * dependencies once all exist. Every record to write first passes the issue check (its type and sections, and the
 * prose as warnings): a failing record is refused (`refuse <id>` and its problems), the others go ahead. With
 * `update`, existing issues whose title, body, type, priority or role differ from their record are rewritten.
 * Returns one line per action.
 */
export async function runImport(
  backlog: Backlog,
  records: ImportRecord[],
  options: ImportOptions = {}
): Promise<string[]> {
  const lines: string[] = [];
  const existing = new Map<string, number>();
  const raws = new Map<string, RawIssue>();
  const closed = new Set<number>();
  for (const raw of await backlog.api.listIssues(true)) {
    const id = MARKER.exec(raw.body)?.[1];
    if (id) {
      existing.set(id, raw.number);
      raws.set(id, raw);
    }
    if (!raw.open) closed.add(raw.number);
  }
  const wanted = records.filter(r => r.status !== "done" || options.done === "closed");
  const skipped = new Set(records.filter(r => !wanted.includes(r)).map(r => r.id));
  const planned = new Set<string>();

  // The issue check over every record that will be written, in one Vale run.
  const toCheck = wanted.filter(r => !existing.has(r.id) || options.update);
  const items = new Map(toCheck.map(r => [r.id, newItemOf(r)]));
  const bodies = new Map(toCheck.map(r => [r.id, backlog.bodyFor(items.get(r.id) as NewItem)]));
  const reports = await checkIssues(
    toCheck.map(r => ({ title: r.title, type: r.type, body: bodies.get(r.id) as string })),
    backlog.config,
    { root: process.cwd(), ...options.check, itemIds: records.map(r => r.id) }
  );
  const reportOf = new Map(toCheck.map((r, i) => [r.id, reports[i]]));
  const skippedNote = reports[0]?.skipped;
  if (skippedNote && !skippedNote.endsWith(" off")) lines.push(`note: ${skippedNote}`);

  for (const r of wanted) {
    const have = existing.get(r.id);
    const report = reportOf.get(r.id);
    if (have !== undefined && !options.update) {
      lines.push(`exists #${have} ${r.id}`);
      continue;
    }
    if (report && report.errors > 0) {
      lines.push(...refusal(r, report));
      continue;
    }
    const item = items.get(r.id) as NewItem;
    if (have !== undefined) {
      const raw = raws.get(r.id) as RawIssue;
      const body = updatedBody(bodies.get(r.id) as string, raw.body);
      if (options.dryRun) {
        const changes = differences(backlog, raw, item, body);
        lines.push(changes.length > 0 ? `update #${have} ${r.id}: ${changes.join(", ")}` : `exists #${have} ${r.id}`);
      } else {
        const changes = await updateIssue(backlog, raw, item, body);
        lines.push(changes.length > 0 ? `updated #${have} ${r.id}: ${changes.join("; ")}` : `exists #${have} ${r.id}`);
      }
      if (report) lines.push(...warnings(r, report));
      continue;
    }
    if (options.dryRun) {
      planned.add(r.id);
      lines.push(
        `create ${r.id} [${[r.component, r.priority, r.status, r.role].filter(Boolean).join(" ")}] ${r.title}`
      );
      if (report) lines.push(...warnings(r, report));
      continue;
    }
    const created = (await backlog.create(item, false)).item;
    existing.set(r.id, created.number);
    lines.push(`created #${created.number} ${r.id}`);
    if (report) lines.push(...warnings(r, report));
    if (r.status === "done") {
      await backlog.done(created.number, "Imported as done.");
      closed.add(created.number);
      lines.push(`closed #${created.number} ${r.id}`);
    } else if (r.status !== "open") {
      await backlog.setStatus(created.number, r.status);
      lines.push(`status #${created.number} ${r.status}`);
    }
  }
  const refused = new Set(wanted.filter(r => (reportOf.get(r.id)?.errors ?? 0) > 0).map(r => r.id));
  for (const r of wanted) {
    for (const warning of r.warnings ?? []) lines.push(`warn ${r.id}: ${warning}`);
    if (refused.has(r.id)) continue;
    const number = existing.get(r.id);
    const links: [string, string][] = [
      ...(r.parent ? [["parent", r.parent] as [string, string]] : []),
      ...r.dependsOn.map(d => ["blocked by", d] as [string, string]),
    ];
    for (const [kind, id] of links) {
      if (skipped.has(id)) continue; // a done item that was not imported: nothing to link or wait for
      if (refused.has(id)) {
        lines.push(`warn ${r.id}: ${kind} "${id}" was refused`);
        continue;
      }
      if (options.dryRun && (planned.has(id) || planned.has(r.id))) {
        lines.push(`${kind} ${r.id} -> ${id}`);
        continue;
      }
      const other = existing.get(id);
      if (other === undefined || number === undefined) {
        lines.push(`warn ${r.id}: ${kind} "${id}" not found`);
        continue;
      }
      if (options.dryRun) {
        lines.push(`${kind} ${r.id} -> ${id}`);
        continue;
      }
      if (kind !== "parent" && closed.has(number)) continue;
      const outcome = kind === "parent" ? await backlog.setParent(number, other) : await backlog.block(number, other);
      if (outcome.changed) lines.push(`${kind} #${number} -> #${other}`);
    }
  }
  return lines;
}

/** Whether an import refused records (the CLI then exits with 1). */
export function importRefused(lines: string[]): boolean {
  return lines.some(l => l.startsWith("refuse "));
}
