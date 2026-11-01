// SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
// SPDX-License-Identifier: MIT

import type { EngineInterface, Register } from "claude-code";

/**
 * Claude Code companion of PlanMe. In a repository with `.plan-me.json` (elsewhere every hook passes):
 * - `gh issue create`, `gh issue edit` and `gh issue close` are denied: they bypass the board fields; plan-me's
 *   commands (or its MCP tools) keep them right;
 * - a Write or Edit of the generated `docs/decisions.md`, or of an issue form plan-me generated (the
 *   `# plan-me:sha256=` line), is denied;
 * - `git commit` with decision files changed runs the bundled `plan-me decisions check` and is denied on problems;
 * - the session starts with one toast naming `plan-me snapshot` and `plan-me next`.
 * The checking is the same deterministic plan-me CLI, bundled in `../bundle`.
 */

export const CONFIG = ".plan-me.json";
export const INDEX = "docs/decisions.md";
export const DECISIONS = "docs/decisions";
export const FORM_MARKER = "# plan-me:sha256=";

// A command at the start of a line, or after ;, &&, ||, |, ( or $( (so `echo gh issue create` passes).
const START = String.raw`(?:^|[;&|(\n])\s*`;
const GH_ISSUE = new RegExp(
  `${START}gh\\s+(?:(?:-R|--repo)(?:\\s+|=)\\S+\\s+)?issue\\s+(create|new|edit|close)(?=\\s|$)`
);
const GIT_COMMIT = new RegExp(`${START}git\\s+(?:-[Cc]\\s+\\S+\\s+)*commit(?=\\s|$)`);
// The command stages files itself: `git add ...`, or `git commit -a` / `-am` / `--all`.
const STAGES =
  /(?:^|[;&|(\n])\s*git\s+(?:-[Cc]\s+\S+\s+)*add(?=\s|$)|\scommit\b[^;&|\n]*\s(?:-[b-zA-Z]*a[a-zA-Z]*|--all)(?=\s|$)/;
const FORM = /^\.github\/ISSUE_TEMPLATE\/[^/]+\.ya?ml$/;

/** The gh issue subcommand a Bash command runs (`new` is gh's alias of `create`), or undefined. */
export function ghIssue(command: string): "create" | "edit" | "close" | undefined {
  const m = GH_ISSUE.exec(command);
  if (!m) return undefined;
  return m[1] === "new" ? "create" : (m[1] as "create" | "edit" | "close");
}

/** Whether a Bash command runs `git commit`, and whether it stages files itself. */
export function gitCommit(command: string): { commit: boolean; stages: boolean } {
  return { commit: GIT_COMMIT.test(command), stages: STAGES.test(command) };
}

/** Whether `git status --porcelain` lines show a change git commit would take (staged, or any when `all`). */
export function decisionChanges(porcelain: string, all: boolean): boolean {
  return porcelain
    .split("\n")
    .filter(line => line.length > 3)
    .some(line => all || (line[0] !== " " && line[0] !== "?"));
}

/** A path relative to the root, or undefined when it lies outside. */
export function relative(root: string, cwd: string, file: string): string | undefined {
  const abs = file.startsWith("/") ? file : `${cwd}/${file}`;
  const parts: string[] = [];
  for (const p of abs.split("/")) {
    if (p === "..") parts.pop();
    else if (p !== "." && p !== "") parts.push(p);
  }
  const norm = `/${parts.join("/")}`;
  return norm.startsWith(`${root}/`) ? norm.slice(root.length + 1) : undefined;
}

const NOTHING = "Nothing was run.";
const SKILL = "The working-with-plan-me skill shows the whole flow.";

export const DENY_ISSUE: Record<"create" | "edit" | "close", string> = {
  create:
    "plan-me: `gh issue create` makes an issue without the board fields (component board, Status, Priority, Role) " +
    `this repository keeps with plan-me. ${NOTHING}\n` +
    'Use `plan-me new "<title>" --component <c> --priority P2 --role <r> [--type Bug] [--parent <n>] [--body ...]` ' +
    '(the MCP tool `new`); a question for the user: `plan-me ask "<title>" "<question>"` (`ask`).\n' +
    SKILL,
  edit:
    "plan-me: `gh issue edit` changes labels, fields or text behind the board's back in a repository kept with " +
    `plan-me. ${NOTHING}\n` +
    "Use `plan-me start <n> --branch <n>-<slug>` (in-progress), `plan-me block <n> --by <m>`, " +
    '`plan-me ask <n> "<question>"` (needs-decision), `plan-me done <n> --note "..."`, or the MCP tools of the same ' +
    "names; a note goes in `gh issue comment <n>`.\n" +
    SKILL,
  close:
    "plan-me: `gh issue close` leaves the board's Status behind in a repository kept with plan-me. " +
    `${NOTHING}\n` +
    'Use `plan-me done <n> --note "..."` (the MCP tool `done`): a Done comment, closed, Status done; or let the ' +
    "pull request's `Closes #<n>` do it on merge.\n" +
    SKILL,
};

export const DENY_INDEX =
  `plan-me: ${INDEX} is generated; never edit it by hand. Record a decision with ` +
  '`plan-me decide "<text>" --title "..." --by "..."` (the MCP tool `decide`), change one in its file under ' +
  `${DECISIONS}/, then regenerate the index with \`plan-me decisions index\` (\`decisions_index\`).`;

export const DENY_FORM = (file: string): string =>
  `plan-me: ${file} is an issue form plan-me generated (its \`${FORM_MARKER}\` line); never edit it by hand. ` +
  "Change the templates in the configuration and run `plan-me templates`.";

export const START_NOTE =
  "plan-me: read the backlog once with `plan-me snapshot --out backlog.txt` and grep it; `plan-me next` gives the next job.";

/**
 * The plan-me root of a working directory: the nearest folder upwards with `.plan-me.json`, stopping at the git
 * root (null: none). Remembered per directory in `cache`.
 */
async function rootOf(
  $: EngineInterface,
  cwd: string,
  cache: Map<string, Promise<string | null>>
): Promise<string | null> {
  let found = cache.get(cwd);
  if (!found) {
    found = findRoot($, cwd).catch(() => null);
    cache.set(cwd, found);
  }
  return found;
}

async function findRoot($: EngineInterface, cwd: string): Promise<string | null> {
  for (let dir = cwd.replace(/\/+$/, "") || "/"; ;) {
    if (await $.fs.exists(`${dir === "/" ? "" : dir}/${CONFIG}`)) return dir;
    if (dir === "/" || (await $.fs.exists(`${dir}/.git`))) return null;
    dir = dir.slice(0, dir.lastIndexOf("/")) || "/";
  }
}

export const register: Register = on => {
  // The plan-me root per working directory: the nearest folder upwards with .plan-me.json (null: none).
  const roots = new Map<string, Promise<string | null>>();
  // One toast per session when the decisions check cannot run: a broken checker must not lock the session.
  let noted = false;

  on("session.start", async ($, e, next) => {
    const started = await next(e);
    const root = await rootOf($, e.cwd, roots);
    if (root) $.ui.toast(START_NOTE);
    return started;
  });

  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    const issue = ghIssue(e.command);
    const commit = gitCommit(e.command);
    if (!issue && !commit.commit) return next(e);
    const cwd = await $.session.cwd();
    const root = await rootOf($, cwd, roots);
    if (!root) return next(e);
    if (issue) return { deny: DENY_ISSUE[issue] };

    const status = await $.process
      .run(["git", "status", "--porcelain", "--", DECISIONS, INDEX], { cwd: root })
      .catch(() => undefined);
    if (!status || status.exitCode !== 0 || !decisionChanges(status.stdout, commit.stages)) return next(e);

    const run = await $.process
      .run(["node", `${$.plugin.root}/bundle/index.js`, "decisions", "check"], { cwd: root, timeoutMs: 60000 })
      .catch(() => undefined);
    if (run && run.exitCode === 1) {
      return {
        deny:
          `plan-me: the decision files have problems, so the commit was not made.\n\n${run.stdout.trim()}\n\n` +
          `Fix the files under ${DECISIONS}/ and run \`plan-me decisions index\`; never edit ${INDEX} by hand.`,
      };
    }
    if (!run || run.exitCode !== 0) {
      if (!noted) {
        noted = true;
        const why = (run?.stderr || "node is not available").trim().split("\n")[0];
        $.ui.toast(`plan-me: decisions not checked (${why}).`);
      }
    }
    return next(e);
  });

  on("tool.call", { tool: ["Write", "Edit"] }, async ($, e, next) => {
    if (e.tool !== "Write" && e.tool !== "Edit") return next(e);
    const cwd = await $.session.cwd();
    const root = await rootOf($, cwd, roots);
    if (!root) return next(e);
    const file = relative(root, cwd, e.file_path);
    if (file === INDEX) return { deny: DENY_INDEX };
    if (file && FORM.test(file)) {
      const before = await $.fs.read(`${root}/${file}`).catch(() => "");
      const written = e.tool === "Write" ? e.content : e.new_string;
      if (`${before}`.includes(FORM_MARKER) || written.includes(FORM_MARKER)) return { deny: DENY_FORM(file) };
    }
    return next(e);
  });
};
