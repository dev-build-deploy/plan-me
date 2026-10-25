/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { z } from "zod";

import { Backlog, Filters, Outcome } from "./backlog.js";
import { STATUSES } from "./config.js";
import { formatItem, Item } from "./item.js";

/** A command's output: compact text (the default) and the same data as JSON (`--json`, MCP). */
export interface CommandResult {
  text: string;
  json: unknown;
}

/** A command shared by the CLI and the MCP server: one description, one input schema, one implementation. */
export interface CommandSpec<S extends z.ZodRawShape> {
  description: string;
  input: S;
  /** Whether the command changes GitHub (MCP annotation). */
  mutates: boolean;
  run: (backlog: Backlog, args: z.infer<z.ZodObject<S>>) => Promise<CommandResult>;
}

const ref = z.union([z.string(), z.number()]).describe("The issue: 12, #12 or an id from the hidden marker");
const filters = {
  component: z.string().optional().describe("Only this component"),
  role: z.string().optional().describe("Only this role"),
  status: z.enum(STATUSES).optional().describe("Only this status"),
  priority: z.string().optional().describe("Only this priority (P1, P2, P3)"),
  type: z.string().optional().describe("Only this type (Feature, Bug, Epic, ...)"),
  parent: z.number().optional().describe("Only the children of this epic"),
};

/** One line per item (`(none)` when empty). */
export function itemsResult(backlog: Backlog, items: Item[]): CommandResult {
  const text = items.length > 0 ? items.map(i => formatItem(backlog.config, i)).join("\n") : "(none)";
  return { text, json: items };
}

/** `#12 status open -> in-progress; ...` or `#12 unchanged`, then the item line. */
export function outcomeResult(backlog: Backlog, o: Outcome): CommandResult {
  const head = o.changed ? `#${o.item.number} ${o.actions.join("; ")}` : `#${o.item.number} unchanged`;
  return { text: `${head}\n${formatItem(backlog.config, o.item)}`, json: o };
}

function define<S extends z.ZodRawShape>(spec: CommandSpec<S>): CommandSpec<S> {
  return spec;
}

/** The commands exposed as MCP tools (and used by the CLI). */
export const COMMANDS = {
  next: define({
    description:
      "The next item to pick up: open and unblocked, P1 before P2 before P3; in-progress and needs-decision first",
    input: { ...filters, limit: z.number().int().positive().optional().describe("How many (default 1)") },
    mutates: false,
    run: async (b, a) => itemsResult(b, await b.next(a as Filters, a.limit ?? 1)),
  }),
  list: define({
    description: "The items matching the filters, one line each, in pick-up order",
    input: { ...filters, state: z.enum(["open", "closed", "all"]).optional().describe("Default open") },
    mutates: false,
    run: async (b, a) => itemsResult(b, await b.list(a)),
  }),
  show: define({
    description: "One item with its body",
    input: { ref },
    mutates: false,
    run: async (b, a) => {
      const item = await b.show(a.ref);
      return { text: `${formatItem(b.config, item)}\n${item.url}\n\n${item.body.trim()}`, json: item };
    },
  }),
  snapshot: define({
    description: "The whole open backlog, one line per item, epics with their children indented",
    input: {},
    mutates: false,
    run: async b => {
      const text = await b.snapshot();
      return { text: text.trimEnd(), json: { snapshot: text } };
    },
  }),
  new: define({
    description: "Create an item (idempotent when an id is given)",
    input: {
      title: z.string(),
      body: z.string().optional(),
      type: z.string().optional().describe("Feature, Bug, Task, Design, Decision, Epic"),
      priority: z.string().optional(),
      component: z.string().optional(),
      role: z.string().optional(),
      size: z.string().optional(),
      parent: ref.optional().describe("The parent epic"),
      blockedBy: z.array(ref).optional(),
      design: z.array(z.string()).optional().describe("Design doc paths or URLs"),
      id: z.string().optional().describe("A stable id (hidden marker)"),
    },
    mutates: true,
    run: async (b, a) =>
      outcomeResult(b, await b.create({ ...a, parent: a.parent?.toString(), blockedBy: a.blockedBy?.map(String) })),
  }),
  start: define({
    description: "Mark an item in-progress (optionally with its branch)",
    input: { ref, branch: z.string().optional() },
    mutates: true,
    run: async (b, a) => outcomeResult(b, await b.start(a.ref, a.branch)),
  }),
  block: define({
    description: "Mark an item blocked by another",
    input: { ref, by: ref },
    mutates: true,
    run: async (b, a) => outcomeResult(b, await b.block(a.ref, a.by)),
  }),
  decide: define({
    description: "Mark an item needs-decision (optionally with the question as a comment)",
    input: { ref, question: z.string().optional() },
    mutates: true,
    run: async (b, a) => outcomeResult(b, await b.decide(a.ref, a.question)),
  }),
  done: define({
    description: "Finish an item: a Done comment, closed, status done",
    input: { ref, note: z.string().optional() },
    mutates: true,
    run: async (b, a) => outcomeResult(b, await b.done(a.ref, a.note)),
  }),
};

/** The command names. */
export type CommandName = keyof typeof COMMANDS;
