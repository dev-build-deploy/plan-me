/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import fs from "fs";
import path from "path";

import { Backlog } from "./backlog.js";
import { Config, Status, STATUSES } from "./config.js";
import { MARKER } from "./item.js";

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
}

const TITLE_MAX = 100;
const TITLE_MIN_CLAUSE = 30;
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Parses the flat YAML front matter plan-me reads (`key: value`, `key: [a, b]`, quoted strings). */
export function parseFrontMatter(text: string): { data: Record<string, string | string[]>; content: string } {
  const m = FRONT_MATTER.exec(text);
  if (!m) return { data: {}, content: text };
  const data: Record<string, string | string[]> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*?)\s*$/.exec(line);
    if (!kv) continue;
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
 * A short title from free text: up to the first sentence end (or a colon after at least TITLE_MIN_CLAUSE
 * characters), outside brackets and quotes, cut at a word boundary.
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
    const breaks = text[i + 1] === " " && (c === "." || (c === ":" && i >= TITLE_MIN_CLAUSE));
    if (breaks && depth === 0 && !quoted) {
      end = i;
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
    const body = [
      content.replace(/^\s*#\s+.*\r?\n/, "").trim(),
      decisions ? `Decisions: ${decisions}` : "",
      asString(data.owner) ? `Owner: ${asString(data.owner)}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    records.push({
      id,
      title,
      body,
      type: mapType(config, asString(data.type)),
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

/**
 * Adapter (b): a markdown line list. `## P1` headings set the priority; `- **id** · text. Helper: role.` starts an
 * item (indented lines continue it); `- ~~id~~ done ...` is a done item; text starting "In progress" is in-progress.
 */
export function readLineList(config: Config, file: string, options: ImportOptions = {}): ImportRecord[] {
  const records: ImportRecord[] = [];
  const priorities = Object.keys(config.fields.priority.options);
  let priority: string | undefined;
  let current: { id: string; text: string[]; done: boolean; priority?: string } | undefined;
  const flush = (): void => {
    if (!current) return;
    const text = current.text.join(" ").replace(/\s+/g, " ").trim();
    const role = /Helper: ([\w-]+)\.?\s*$/.exec(text)?.[1];
    const inProgress = /^In progress\b/i.test(text);
    const titleText = text.replace(/^In progress(?: \([^)]*\))?\.?\s*/i, "").replace(/^done\s*/i, "");
    records.push({
      id: current.id,
      title: shortTitle(titleText.replace(/^\([^)]*\):?\s*/, "") || current.id),
      body: text,
      status: current.done ? "done" : inProgress ? "in-progress" : "open",
      priority: current.priority,
      component: options.component,
      role,
      dependsOn: [],
      design: [],
      source: file,
    });
    current = undefined;
  };
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const heading = /^##\s+(\S+)/.exec(line);
    if (heading) {
      flush();
      priority = priorities.includes(heading[1]) ? heading[1] : priority;
      continue;
    }
    const open = /^- \*\*([\w.-]+)\*\*\s*·?\s*(.*)$/.exec(line);
    const done = /^- ~~([\w.-]+)~~\s*(.*)$/.exec(line);
    if (open || done) {
      flush();
      const m = (open ?? done) as RegExpExecArray;
      current = { id: m[1], text: [m[2]], done: !!done, priority };
    } else if (current && /^\s+\S/.test(line)) {
      current.text.push(line.trim());
    } else if (line.trim() === "" || /^\S/.test(line)) {
      flush();
    }
  }
  flush();
  return records;
}

/**
 * Creates the issues for the records (idempotent through the hidden id marker), then resolves parents and
 * dependencies once all exist. Returns one line per action.
 */
export async function runImport(
  backlog: Backlog,
  records: ImportRecord[],
  options: ImportOptions = {}
): Promise<string[]> {
  const lines: string[] = [];
  const existing = new Map<string, number>();
  const closed = new Set<number>();
  for (const raw of await backlog.api.listIssues(true)) {
    const id = MARKER.exec(raw.body)?.[1];
    if (id) existing.set(id, raw.number);
    if (!raw.open) closed.add(raw.number);
  }
  const wanted = records.filter(r => r.status !== "done" || options.done === "closed");
  const skipped = new Set(records.filter(r => !wanted.includes(r)).map(r => r.id));
  const planned = new Set<string>();
  for (const r of wanted) {
    const have = existing.get(r.id);
    if (have !== undefined) {
      lines.push(`exists #${have} ${r.id}`);
      continue;
    }
    if (options.dryRun) {
      planned.add(r.id);
      lines.push(
        `create ${r.id} [${[r.component, r.priority, r.status, r.role].filter(Boolean).join(" ")}] ${r.title}`
      );
      continue;
    }
    const { item } = await backlog.create(
      {
        id: r.id,
        title: r.title,
        body: `${r.body}\n\n_Imported from ${r.source}_`,
        type: r.type,
        priority: r.priority,
        component: r.component,
        role: r.role,
        design: r.design,
      },
      false
    );
    existing.set(r.id, item.number);
    lines.push(`created #${item.number} ${r.id}`);
    if (r.status === "done") {
      await backlog.done(item.number, "Imported as done.");
      closed.add(item.number);
      lines.push(`closed #${item.number} ${r.id}`);
    } else if (r.status !== "open") {
      await backlog.setStatus(item.number, r.status);
      lines.push(`status #${item.number} ${r.status}`);
    }
  }
  for (const r of wanted) {
    const number = existing.get(r.id);
    const links: [string, string][] = [
      ...(r.parent ? [["parent", r.parent] as [string, string]] : []),
      ...r.dependsOn.map(d => ["blocked by", d] as [string, string]),
    ];
    for (const [kind, id] of links) {
      if (skipped.has(id)) continue; // a done item that was not imported: nothing to link or wait for
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
