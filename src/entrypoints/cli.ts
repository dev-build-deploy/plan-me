#!/usr/bin/env node

/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { execFileSync } from "child_process";
import fs from "fs";

import { getOctokit } from "@actions/github";
import { Command } from "commander";

import { Backlog } from "../backlog";
import { CommandName, COMMANDS } from "../commands";
import { CONFIG_FILE, loadConfig } from "../config";
import { DEFAULT_DRIVER_COMMAND, installMergeDriver, runMergeDriver } from "../decisions-merge";
import { GitHubApi, OctokitLike } from "../github";
import { readItemFolder, readLineList, runImport } from "../importer";
import { runMcpServer } from "../mcp";

type Globals = { config: string; repo?: string; json?: boolean };

/** The token: GITHUB_TOKEN, GH_TOKEN, or the GitHub CLI's (`gh auth token`). */
function token(): string {
  const env = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (env) return env;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  } catch (_e) {
    throw new Error("no token: set GITHUB_TOKEN or GH_TOKEN, or log in with `gh auth login`");
  }
}

/** A backlog for the global options (config file, repository override). */
function backlogFor(g: Globals): Backlog {
  const config = loadConfig(g.config, g.repo);
  const octokit = getOctokit(token()) as unknown as OctokitLike;
  return new Backlog(new GitHubApi(octokit, config.repository, config.owner), config);
}

function print(g: Globals, text: string, json: unknown): void {
  process.stdout.write(`${g.json ? JSON.stringify(json, null, 2) : text}\n`);
}

/** Runs a shared command and prints its result. */
async function run(cmd: Command, name: CommandName, args: Record<string, unknown>): Promise<void> {
  const g = cmd.optsWithGlobals<Globals>();
  const spec = COMMANDS[name];
  const result = await spec.run({ backlog: () => backlogFor(g), root: process.cwd() }, args as never);
  if (result.warning) process.stderr.write(`${result.warning}\n`);
  print(g, result.text, result.json);
  if (result.failed) process.exitCode = 1;
}

/** Collects a repeatable option into a list. */
function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

const program = new Command();

/**
 * Main entry point for the CLI tool.
 */
program
  .name("plan-me")
  .description("Deterministic GitHub backlog management (Issues + Projects v2) for humans and LLMs")
  .option("-c, --config <file>", "The configuration file", CONFIG_FILE)
  .option("-r, --repo <owner/name>", "The repository (overrides the configuration)")
  .option("--json", "Print JSON instead of compact text");

function withFilters(cmd: Command): Command {
  return cmd
    .option("--component <c>", "Only this component")
    .option("--role <r>", "Only this role")
    .option("--status <s>", "Only this status")
    .option("--priority <p>", "Only this priority")
    .option("--type <t>", "Only this type")
    .option("--parent <n>", "Only the children of this epic", v => +v.replace("#", ""));
}

program
  .command("init")
  .description("Create the missing boards, fields, options and labels (idempotent)")
  .option("--dry-run", "Only print what would be created")
  .action(async (opts: { dryRun?: boolean }, cmd: Command) => {
    const g = cmd.optsWithGlobals<Globals>();
    const actions = await backlogFor(g).init(!!opts.dryRun);
    print(g, actions.length > 0 ? actions.join("\n") : "up to date", { actions, dryRun: !!opts.dryRun });
  });

program
  .command("new <title>")
  .description("Create an item")
  .option("--body <text>", "The body (markdown)")
  .option("--type <t>", "Feature, Bug, Task, Design, Decision, Epic")
  .option("--priority <p>", "P1, P2, P3 (default from the config)")
  .option("--component <c>", "The component (its board)")
  .option("--role <r>", "The role that does it")
  .option("--size <s>", "The size")
  .option("--parent <ref>", "The parent epic")
  .option("--blocked-by <ref>", "A blocker (repeatable)", collect)
  .option("--design <path>", "A design doc (repeatable)", collect)
  .option("--id <id>", "A stable id (hidden marker); makes `new` idempotent")
  .action(async (title: string, opts: Record<string, unknown>, cmd: Command) => run(cmd, "new", { title, ...opts }));

program
  .command("start <ref>")
  .description("Mark an item in-progress")
  .option("--branch <b>", "The branch working on it")
  .action(async (ref: string, opts: { branch?: string }, cmd: Command) => run(cmd, "start", { ref, ...opts }));

program
  .command("block <ref>")
  .description("Mark an item blocked by another")
  .requiredOption("--by <ref>", "The blocker")
  .action(async (ref: string, opts: { by: string }, cmd: Command) => run(cmd, "block", { ref, by: opts.by }));

program
  .command("ask <ref-or-title> [question]")
  .description(
    "Open a question: an issue (12, #12, an id) becomes needs-decision with the question as a comment; " +
      "any other text is a new question's title (a new issue, needs-decision)"
  )
  .action(async (target: string, question: string | undefined, _opts: unknown, cmd: Command) =>
    run(cmd, "ask", { ref: target, question })
  );

program
  .command("decide <text>")
  .description("Record a decision: writes docs/decisions/<date>-<id>.md and regenerates docs/decisions.md")
  .option("--title <t>", "The decision's title (its slug is the id)")
  .option("--by <who>", "Who decided")
  .option("--question <ref>", "The question issue it answers (12 or #12)")
  .option("--summary <line>", "One line for the index (default the title)")
  .option("--scope <area>", "An area it applies to (repeatable)", collect)
  .option("--supersedes <id>", "The decision it replaces (becomes superseded)")
  .option("--amends <id>", "The decision it changes (becomes amended)")
  .option("--date <yyyy-mm-dd>", "The date (default today)")
  .option("--id <id>", "The id (default the title's slug)")
  .action(async (first: string, opts: Record<string, unknown>, cmd: Command) =>
    // Without --title this is the deprecated `decide <ref> [--question "<text>"]`, which is `ask`.
    run(cmd, "decide", opts.title === undefined ? { ref: first, question: opts.question } : { text: first, ...opts })
  );

const decisions = program.command("decisions").description("The decision files (docs/decisions/) and their index");

decisions
  .command("index")
  .description("Regenerate docs/decisions.md from docs/decisions/ (never edit it by hand)")
  .action(async (_opts: unknown, cmd: Command) => run(cmd, "decisions_index", {}));

decisions
  .command("check")
  .description("Fail when a decision file is invalid, ids collide, superseded_by points nowhere or the index is stale")
  .action(async (_opts: unknown, cmd: Command) => run(cmd, "decisions_check", {}));

decisions
  .command("import <file>")
  .description("Convert an old numbered list into one file per decision, keeping the numbers (rerunnable)")
  .requiredOption("--format <f>", "numbered (`129. **Title** (date, by): text`) or labelled (`- **L99** (date) text`)")
  .option("--by <who>", "Who decided, for entries that don't say", "unknown")
  .option("--scope <area>", "A scope for every imported decision (repeatable)", collect)
  .option("--dry-run", "Only print what would be written")
  .action(async (file: string, opts: Record<string, unknown>, cmd: Command) =>
    run(cmd, "decisions_import", { file, ...opts })
  );

program
  .command("done <ref>")
  .description("Finish an item: a Done comment, closed, status done")
  .option("--note <text>", "The Done note")
  .action(async (ref: string, opts: { note?: string }, cmd: Command) => run(cmd, "done", { ref, ...opts }));

withFilters(program.command("next").description("The next item to pick up"))
  .option("--limit <n>", "How many", v => +v)
  .action(async (opts: Record<string, unknown>, cmd: Command) => run(cmd, "next", opts));

withFilters(program.command("list").description("The items matching the filters"))
  .option("--state <s>", "open (default), closed or all")
  .action(async (opts: Record<string, unknown>, cmd: Command) => run(cmd, "list", opts));

program
  .command("show <ref>")
  .description("One item with its body")
  .action(async (ref: string, _opts: unknown, cmd: Command) => run(cmd, "show", { ref }));

decisions
  .command("install")
  .description("Set up the merge driver that regenerates docs/decisions.md on merges (once per clone)")
  .option("--command <cmd>", "How git starts plan-me", DEFAULT_DRIVER_COMMAND)
  .action(async (opts: { command: string }, cmd: Command) => {
    const g = cmd.optsWithGlobals<Globals>();
    const actions = installMergeDriver(process.cwd(), opts.command);
    print(g, actions.length > 0 ? actions.join("\n") : "merge driver installed", { actions });
  });

decisions
  .command("merge-driver <base> <ours> <theirs>")
  .description("Git's merge driver for docs/decisions.md (git runs it: %O %A %B); see `decisions install`")
  .action(async (base: string, ours: string, theirs: string) => {
    if (!runMergeDriver(base, ours, theirs)) process.exitCode = 1;
  });

program
  .command("snapshot")
  .description("The open backlog, one line per item (grep it instead of calling the API)")
  .option("--out <file>", "Write to a file instead of stdout")
  .action(async (opts: { out?: string }, cmd: Command) => {
    const g = cmd.optsWithGlobals<Globals>();
    const text = await backlogFor(g).snapshot();
    if (!opts.out) return print(g, text.trimEnd(), { snapshot: text });
    fs.writeFileSync(opts.out, text);
    const lines = text.split("\n").length - 1;
    print(g, `wrote ${opts.out} (${lines} lines)`, { out: opts.out, lines });
  });

program
  .command("import <path>")
  .description("Import a markdown backlog: a folder of item files, or a line list (idempotent)")
  .option("--format <f>", "folder or lines (default: folder for a directory)")
  .option("--component <c>", "The component for items whose area names none")
  .option("--design-prefix <p>", "Prefix for design doc paths", "docs/")
  .option("--done <mode>", "Done items: skip or closed", "skip")
  .option("--dry-run", "Only print what would be created")
  .action(async (target: string, opts: Record<string, string | boolean>, cmd: Command) => {
    const g = cmd.optsWithGlobals<Globals>();
    const backlog = backlogFor(g);
    const options = {
      component: opts.component as string | undefined,
      designPrefix: opts.designPrefix as string,
      done: opts.done as "skip" | "closed",
      dryRun: !!opts.dryRun,
    };
    const folder = (opts.format ?? (fs.statSync(target).isDirectory() ? "folder" : "lines")) === "folder";
    const records = folder
      ? readItemFolder(backlog.config, target, options)
      : readLineList(backlog.config, target, options);
    const lines = await runImport(backlog, records, options);
    print(g, lines.length > 0 ? lines.join("\n") : "nothing to import", { records: records.length, actions: lines });
  });

program
  .command("mcp")
  .description("Run as an MCP server on stdio (the same commands as tools)")
  .action(async (_opts: unknown, cmd: Command) => {
    const g = cmd.optsWithGlobals<Globals>();
    await runMcpServer(() => backlogFor(g));
  });

program.parseAsync().catch((e: Error) => {
  process.stderr.write(`error: ${e.message}\n`);
  process.exit(1);
});
