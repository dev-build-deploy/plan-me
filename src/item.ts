/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { RawIssue } from "./api";
import { Config, priorityKeys, SelectField, Status } from "./config";

/** A backlog item: an issue read through the configuration (component, board fields, links). */
export interface Item {
  number: number;
  /** The stable id from the hidden marker (imports, `new --id`), if any. */
  id?: string;
  title: string;
  url: string;
  open: boolean;
  status: Status;
  priority?: string;
  role?: string;
  size?: string;
  component: string;
  type?: string;
  parent?: number;
  children: number[];
  /** The open issues blocking this one. */
  blockedBy: number[];
  labels: string[];
}

/** The hidden body marker that gives an issue a stable id. */
export const MARKER = /<!-- plan-me:id=([^\s>]+) -->/;

/** The marker line for an id. */
export function marker(id: string): string {
  return `<!-- plan-me:id=${id} -->`;
}

/** Status order within a priority for `next` and the snapshot: in-progress, needs-decision, open, blocked, done. */
const STATUS_RANK: Record<Status, number> = { "in-progress": 0, "needs-decision": 1, open: 2, blocked: 3, done: 4 };

function reverse(field: SelectField, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (Object.keys(field.options).length === 0) return value;
  return Object.entries(field.options).find(([, name]) => name === value)?.[0];
}

/** The component of a raw issue: its component label, else the default component. */
export function componentOf(config: Config, raw: RawIssue): string {
  const label = raw.labels.find(l => l.startsWith(config.componentLabelPrefix));
  return label ? label.slice(config.componentLabelPrefix.length) : config.defaultComponent;
}

/** The plan-me type of a raw issue: its issue type, else its type label, matched against the configured types. */
export function typeOf(config: Config, raw: RawIssue): string | undefined {
  const fromLabel = raw.labels.find(l => l.startsWith(config.typeLabelPrefix))?.slice(config.typeLabelPrefix.length);
  const name = raw.issueType ?? fromLabel;
  if (!name) return undefined;
  return config.types.find(t => t.toLowerCase() === name.toLowerCase()) ?? name;
}

/** The board field values of a raw issue for its component's board. */
export function boardValues(config: Config, raw: RawIssue): Record<string, string> {
  const board = config.boards[componentOf(config, raw)];
  return (board && raw.boards[board.title]) ?? {};
}

/**
 * Reads a raw issue through the configuration.
 * @param config The configuration
 * @param raw The issue
 * @param known Other issues by number, to resolve links whose state is unknown (fallback body lines)
 * @param unknownIsClosed A link of unknown state not in `known` counts as closed (`known` holds every open issue)
 * @returns The item
 */
export function toItem(config: Config, raw: RawIssue, known?: Map<number, RawIssue>, unknownIsClosed = false): Item {
  const values = boardValues(config, raw);
  const f = config.fields;
  const fieldStatus = reverse(f.status, values[f.status.name]) as Status | undefined;
  const isOpen = (n: number, open?: boolean): boolean => {
    const other = known?.get(n);
    return other ? other.open : (open ?? !unknownIsClosed);
  };
  return {
    number: raw.number,
    id: MARKER.exec(raw.body)?.[1],
    title: raw.title,
    url: raw.url,
    open: raw.open,
    status: raw.open ? (fieldStatus ?? "open") : "done",
    priority: reverse(f.priority, values[f.priority.name]),
    role: reverse(f.role, values[f.role.name]),
    size: reverse(f.size, values[f.size.name]),
    component: componentOf(config, raw),
    type: typeOf(config, raw),
    parent: raw.parent,
    children: raw.children.map(c => c.number),
    blockedBy: raw.blockedBy.filter(b => isOpen(b.number, b.open)).map(b => b.number),
    labels: raw.labels,
  };
}

/**
 * Reads a list of raw issues, completing the links from both sides (a child naming its parent, a parent listing its
 * children) and resolving fallback blockers against the list (one not in an open-only list counts as closed).
 * @param includesClosed Whether `raws` holds closed issues too
 */
export function toItems(config: Config, raws: RawIssue[], includesClosed: boolean): Item[] {
  const known = new Map(raws.map(r => [r.number, r]));
  const items = raws.map(r => toItem(config, r, known, !includesClosed));
  const byNumber = new Map(items.map(i => [i.number, i]));
  for (const item of items) {
    for (const c of item.children) {
      const child = byNumber.get(c);
      if (child && child.parent === undefined) child.parent = item.number;
    }
    if (item.parent !== undefined) {
      const parent = byNumber.get(item.parent);
      if (parent && !parent.children.includes(item.number)) parent.children.push(item.number);
    }
  }
  return items;
}

/** Sort rank of an item's priority (P1 first, none last). */
export function priorityRank(config: Config, item: Item): number {
  const keys = priorityKeys(config);
  const i = item.priority ? keys.indexOf(item.priority) : -1;
  return i < 0 ? keys.length : i;
}

/** Compares items: priority, then status (in-progress, needs-decision, open, ...), then number. */
export function compareItems(config: Config, a: Item, b: Item): number {
  return (
    priorityRank(config, a) - priorityRank(config, b) ||
    STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
    a.number - b.number
  );
}

/** Whether an item is an epic. */
export function isEpic(config: Config, item: Item): boolean {
  return item.type?.toLowerCase() === config.epicType.toLowerCase();
}

/** One line for an item: `#12 [leertoren P1 in-progress feel-polish] title — blocked by #9`. */
export function formatItem(config: Config, item: Item): string {
  const tags = [item.component, item.priority, item.status, item.role, isEpic(config, item) ? "epic" : undefined];
  const blocked = item.blockedBy.length > 0 ? ` — blocked by ${item.blockedBy.map(n => `#${n}`).join(", ")}` : "";
  return `#${item.number} [${tags.filter(Boolean).join(" ")}] ${item.title}${blocked}`;
}

/**
 * The snapshot: one line per item, grouped by component, epics with their children indented, in `next` order.
 * Deterministic (no timestamps), so two snapshots of the same backlog are byte-equal.
 */
export function formatSnapshot(config: Config, items: Item[]): string {
  const byNumber = new Map(items.map(i => [i.number, i]));
  const sorted = [...items].sort((a, b) => compareItems(config, a, b));
  const lines: string[] = [`# plan-me snapshot ${config.repository}: ${items.length} open items`];
  const seen = new Set<number>();
  const walk = (item: Item, depth: number): void => {
    if (seen.has(item.number)) return;
    seen.add(item.number);
    lines.push(`${"  ".repeat(depth)}${formatItem(config, item)}`);
    const children = item.children.map(c => byNumber.get(c)).filter((c): c is Item => c !== undefined);
    children.sort((a, b) => compareItems(config, a, b)).forEach(c => walk(c, depth + 1));
  };
  const components = [...new Set(sorted.map(i => i.component))].sort();
  for (const component of components) {
    lines.push(`## ${component || "(no component)"}`);
    sorted
      .filter(i => i.component === component && (i.parent === undefined || !byNumber.has(i.parent)))
      .forEach(i => walk(i, 0));
  }
  return lines.join("\n") + "\n";
}
