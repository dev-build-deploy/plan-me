/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { z } from "zod";

import { Backlog, Filters, Outcome } from "./backlog";
import { STATUSES } from "./config";
import { checkDecisions, DEFAULT_DECISIONS, formatIndexLine, recordDecision, writeIndex } from "./decisions";
import { IMPORT_FORMATS, importDecisions } from "./decisions-import";
import { formatItem, Item } from "./item";

/** A command's output: compact text (the default) and the same data as JSON (`--json`, MCP). */
export interface CommandResult {
  text: string;
  json: unknown;
  /** The command found problems (`decisions check`): the CLI exits with 1, the MCP tool answers as an error. */
  failed?: boolean;
  /** A warning for the caller (a deprecated form): the CLI prints it on stderr, the MCP tool before the text. */
  warning?: string;
}

/** The warning for the old `decide <ref> --question "<text>"` form. */
export const DECIDE_DEPRECATED =
  'warning: `decide <ref> --question "<text>"` is deprecated and will be removed: use `plan-me ask <ref> "<question>"`';

/**
 * What a command runs against: the backlog (made on first use, so the local decision commands need no token and no
 * configuration) and the repository root on disk (where the decision files live).
 */
export interface CommandContext {
  backlog: () => Backlog;
  root: string;
}

/** A command shared by the CLI and the MCP server: one description, one input schema, one implementation. */
export interface CommandSpec<S extends z.ZodRawShape> {
  description: string;
  input: S;
  /** Whether the command changes GitHub or the repository's files (MCP annotation). */
  mutates: boolean;
  run: (ctx: CommandContext, args: z.infer<z.ZodObject<S>>) => Promise<CommandResult>;
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

/** Adapts a command that only needs the backlog. */
function onBacklog<A>(
  fn: (backlog: Backlog, args: A) => Promise<CommandResult>
): (ctx: CommandContext, args: A) => Promise<CommandResult> {
  return async (ctx, args) => fn(ctx.backlog(), args);
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
    run: onBacklog(async (b, a) => itemsResult(b, await b.next(a as Filters, a.limit ?? 1))),
  }),
  list: define({
    description: "The items matching the filters, one line each, in pick-up order",
    input: { ...filters, state: z.enum(["open", "closed", "all"]).optional().describe("Default open") },
    mutates: false,
    run: onBacklog(async (b, a) => itemsResult(b, await b.list(a))),
  }),
  show: define({
    description: "One item with its body",
    input: { ref },
    mutates: false,
    run: onBacklog(async (b, a) => {
      const item = await b.show(a.ref);
      return { text: `${formatItem(b.config, item)}\n${item.url}\n\n${item.body.trim()}`, json: item };
    }),
  }),
  snapshot: define({
    description: "The whole open backlog, one line per item, epics with their children indented",
    input: {},
    mutates: false,
    run: onBacklog(async b => {
      const text = await b.snapshot();
      return { text: text.trimEnd(), json: { snapshot: text } };
    }),
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
    run: onBacklog(async (b, a) =>
      outcomeResult(b, await b.create({ ...a, parent: a.parent?.toString(), blockedBy: a.blockedBy?.map(String) }))
    ),
  }),
  start: define({
    description: "Mark an item in-progress (optionally with its branch)",
    input: { ref, branch: z.string().optional() },
    mutates: true,
    run: onBacklog(async (b, a) => outcomeResult(b, await b.start(a.ref, a.branch))),
  }),
  block: define({
    description: "Mark an item blocked by another",
    input: { ref, by: ref },
    mutates: true,
    run: onBacklog(async (b, a) => outcomeResult(b, await b.block(a.ref, a.by))),
  }),
  ask: define({
    description:
      "Open a question: an issue (12, #12, an id) becomes needs-decision with the question as a comment; any other " +
      "text is a new question's title (a new issue, needs-decision, the question as its body; asking again returns it)",
    input: {
      ref: ref.describe("The issue (12, #12, an id), or a new question's title"),
      question: z.string().optional().describe("The question"),
    },
    mutates: true,
    run: onBacklog(async (b, a) => outcomeResult(b, await b.ask(a.ref, a.question))),
  }),
  decide: define({
    description:
      "Record a decision: writes docs/decisions/<date>-<id>.md and regenerates docs/decisions.md. With question " +
      "(the issue it answers, #12), that issue gets the answer and the file's path; the pull request carrying the " +
      "file closes it (Closes #12). To open a question, use ask",
    input: {
      text: z.string().optional().describe("The decision in full (markdown)"),
      title: z.string().optional().describe("The title; its slug is the id"),
      by: z.string().optional().describe("Who decided"),
      question: z.union([z.string(), z.number()]).optional().describe("The question issue it answers (12 or #12)"),
      summary: z.string().optional().describe("One line for the index (default the title)"),
      scope: z.array(z.string()).optional().describe("The areas it applies to"),
      supersedes: z.string().optional().describe("The id of the decision it replaces"),
      amends: z.string().optional().describe("The id of the decision it changes"),
      date: z.string().optional().describe("YYYY-MM-DD (default today)"),
      id: z.string().optional().describe("The id (default the title's slug)"),
      ref: ref.optional().describe("Deprecated: decide with ref (and question text) is ask; use ask"),
    },
    mutates: true,
    run: async (ctx, a) => {
      if (a.title === undefined && a.ref !== undefined) {
        const b = ctx.backlog();
        const result = outcomeResult(b, await b.ask(a.ref, a.question?.toString()));
        return { ...result, warning: DECIDE_DEPRECATED };
      }
      if (!a.text || !a.title || !a.by) throw new Error("decide: recording a decision needs text, title and by");
      const recorded = recordDecision(ctx.root, {
        ...a,
        text: a.text,
        title: a.title,
        by: a.by,
        question: a.question?.toString(),
      });
      const lines = [
        ...(recorded.changed ? recorded.actions : [`${recorded.path} unchanged`]),
        formatIndexLine(recorded.decision),
      ];
      let answered: Outcome | undefined;
      if (recorded.decision.question) {
        const b = ctx.backlog();
        answered = await b.answer(recorded.decision.question, recorded.path, recorded.decision.summary);
        lines.push(outcomeResult(b, answered).text);
      }
      return { text: lines.join("\n"), json: { ...recorded, answered } };
    },
  }),
  done: define({
    description: "Finish an item: a Done comment, closed, status done",
    input: { ref, note: z.string().optional() },
    mutates: true,
    run: onBacklog(async (b, a) => outcomeResult(b, await b.done(a.ref, a.note))),
  }),
  decisions_index: define({
    description: "Regenerate docs/decisions.md from the files in docs/decisions/ (never edit the index by hand)",
    input: {},
    mutates: true,
    run: async ctx => {
      const changed = writeIndex(ctx.root);
      const text = `${DEFAULT_DECISIONS.index} ${changed ? "written" : "up to date"}`;
      return { text, json: { index: DEFAULT_DECISIONS.index, changed } };
    },
  }),
  decisions_check: define({
    description:
      "Check the decisions: valid front matter, unique ids and numbers, superseded_by naming a decision, the index " +
      "up to date and not edited by hand. Fails with one line per problem",
    input: {},
    mutates: false,
    run: async ctx => {
      const problems = checkDecisions(ctx.root);
      const text = problems.length > 0 ? problems.join("\n") : `${DEFAULT_DECISIONS.dir}: ok`;
      return { text, json: { problems }, failed: problems.length > 0 };
    },
  }),
  decisions_import: define({
    description:
      "Convert an old numbered decision list into one file per decision (keeping the numbers), then regenerate the " +
      "index; rerunnable. Formats: numbered (`129. **Title** (2026-11-01, the user): text`), labelled " +
      "(`- **L99** (2026-10-27) text`)",
    input: {
      file: z.string().describe("The list's path, relative to the repository root"),
      format: z.enum(IMPORT_FORMATS),
      by: z.string().optional().describe("Who decided, for entries that don't say (default unknown)"),
      scope: z.array(z.string()).optional().describe("The scope given to every imported decision"),
      dryRun: z.boolean().optional().describe("Only print what would be written"),
    },
    mutates: true,
    run: async (ctx, a) => {
      const actions = importDecisions(ctx.root, a.file, a.format, a);
      return { text: actions.length > 0 ? actions.join("\n") : "nothing to import", json: { actions } };
    },
  }),
};

/** The command names. */
export type CommandName = keyof typeof COMMANDS;
