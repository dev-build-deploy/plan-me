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
 * - `plan-me new` (and the MCP tool `new`) runs the bundled `plan-me check-issue` on the body first: errors deny
 *   always, warnings deny once per body (the same body sent again goes through), as pull-me does for pull requests;
 *   a `gh issue create`/`edit` with a body is denied with the check's findings too;
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

/**
 * The repository a `gh issue` command names with `-R` / `--repo` (before or after `issue <subcommand>`), as a
 * lower-case `owner/name`, or undefined when it names none. Quoted text other than the flag's value (a title, a
 * body) is ignored, so a body that mentions `-R x/y` does not count.
 */
export function ghIssueRepo(command: string): string | undefined {
  const m = GH_ISSUE.exec(command);
  if (!m) return undefined;
  const segment = command
    .slice(m.index)
    .replace(/^[;&|(\n]/, "")
    .split(/[;&|\n]/)[0]
    .replace(/(\s(?:-R|--repo)(?:\s+|=))(["'])([^"']*)\2/g, "$1$3")
    .replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, "''");
  const repo = /\s(?:-R|--repo)(?:\s+|=)(\S+)/.exec(segment)?.[1];
  if (!repo) return undefined;
  return repo
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, "")
    .replace(/(?:\.git)?\/*$/, "")
    .toLowerCase();
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

// --- the issue check (`plan-me new`, the MCP tool `new`, `gh issue create/edit` with a body) ---

/** What an issue-writing command carries: the title, the type and the body (or the file holding it). */
export type IssueCommand = { title?: string; type?: string; body?: string; bodyFile?: string; shell?: boolean };

const PLAN_ME = new RegExp(`${START}(?:npx\\s+(?:(?:-y|--yes)\\s+)?)?(?:\\S*/)?plan-me(?=\\s)`);
const HEREDOC = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n([\s\S]*?)\n[ \t]*\2(?=\s|\)|$)/;
const MCP_NEW = /^mcp__[\w-]*plan-me[\w-]*__new$/;

/** Splits the shell words of the first simple command, honouring quotes; stops at an unquoted operator (pull-me's). */
export function words(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let has = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'") {
      const end = text.indexOf("'", i + 1);
      cur += text.slice(i + 1, end < 0 ? undefined : end);
      i = end < 0 ? text.length : end;
      has = true;
    } else if (c === '"') {
      i++;
      for (; i < text.length && text[i] !== '"'; i++) {
        if (text[i] === "\\" && '"\\$`\n'.includes(text[i + 1] ?? "")) i++;
        cur += text[i];
      }
      has = true;
    } else if (c === "\\" && i + 1 < text.length) {
      cur += text[++i];
      has = true;
    } else if (/\s/.test(c)) {
      if (c === "\n" && !has && out.length === 0) continue;
      if (c === "\n") break;
      if (has) out.push(cur);
      cur = "";
      has = false;
    } else if (";&|".includes(c)) {
      break;
    } else {
      cur += c;
      has = true;
    }
  }
  if (has) out.push(cur);
  return out;
}

/** The words after a command start, with a heredoc body (`--body "$(cat <<'EOF' ...)"`, `--body-file - <<EOF`) read. */
function argsWithHeredoc(rest: string): { args: string[]; heredoc?: string } {
  const heredoc = HEREDOC.exec(rest);
  const before = heredoc ? rest.slice(0, heredoc.index) : "";
  const used = heredoc && /(\s(-b|--body)\s+["']?\$\(|\s(-F|--body-file)\s+-(\s|$)|--body-file=-)/.test(before);
  if (!used) return { args: words(rest) };
  const args = words(before.replace(/\s(-b|--body)\s+["']?\$\(\s*cat\s*$/, " --body __HEREDOC__"));
  return { args, heredoc: heredoc[3] };
}

/** Reads `--body`, `--body-file`, `--title` and `--type` style options into an IssueCommand. */
function readOptions(args: string[], cmd: IssueCommand, short: Record<string, keyof IssueCommand>): string[] {
  const positional: string[] = [];
  const long: Record<string, keyof IssueCommand> = {
    body: "body",
    "body-file": "bodyFile",
    title: "title",
    type: "type",
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const eq = /^--([\w-]+)=(.*)$/s.exec(a);
    const key = eq ? long[eq[1]] : a.startsWith("--") ? long[a.slice(2)] : short[a];
    if (key) {
      (cmd as Record<string, unknown>)[key] = eq ? eq[2] : (args[++i] ?? "");
    } else if (a.startsWith("-")) {
      if (
        /^--(?:priority|component|role|size|parent|blocked-by|design|id|config|repo|label|assignee|milestone|project)$/.test(
          a
        ) ||
        /^-[clr]$/.test(a)
      )
        i++;
    } else {
      positional.push(a);
    }
  }
  return positional;
}

/** Parses a `plan-me new` command (`npx plan-me`, a path to plan-me, global options before `new`). */
export function parsePlanMeNew(command: string): IssueCommand | undefined {
  const m = PLAN_ME.exec(command);
  if (!m) return undefined;
  const { args, heredoc } = argsWithHeredoc(command.slice(m.index + m[0].length));
  const cmd: IssueCommand = {};
  const positional = readOptions(args, cmd, {});
  if (positional[0] !== "new") return undefined;
  cmd.title = positional[1];
  if (heredoc !== undefined) {
    cmd.body = heredoc;
    cmd.bodyFile = undefined;
  }
  cmd.shell = cmd.body?.includes("$(") || cmd.bodyFile === "-";
  return cmd;
}

/** Parses a `gh issue create`/`edit` command's title and body (a `type:` label gives the type). */
export function parseGhIssue(command: string): IssueCommand | undefined {
  const m = GH_ISSUE.exec(command);
  if (!m) return undefined;
  const { args, heredoc } = argsWithHeredoc(command.slice(m.index + m[0].length));
  const cmd: IssueCommand = {};
  for (let i = 0; i < args.length; i++) {
    const label = args[i] === "-l" || args[i] === "--label" ? args[i + 1] : /^--label=(.*)$/.exec(args[i])?.[1];
    const type = label?.split(",").find(l => l.startsWith("type:"));
    if (type) cmd.type = type.slice(5);
  }
  readOptions(args, cmd, { "-b": "body", "-F": "bodyFile", "-t": "title" });
  if (heredoc !== undefined) {
    cmd.body = heredoc;
    cmd.bodyFile = undefined;
  }
  cmd.shell = cmd.body?.includes("$(") || cmd.bodyFile === "-";
  return cmd;
}

/** A small, stable hash of a body (FNV-1a), to remember which bodies were already warned about. */
export function bodyHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

/** The answer of `plan-me check-issue --format hook`, or undefined when it could not run. */
export function parseHook(
  exitCode: number,
  stdout: string
): { errors: number; warnings: number; text: string; skipped?: string } | undefined {
  if (exitCode !== 0 && exitCode !== 1) return undefined;
  try {
    const parsed = JSON.parse(stdout) as { errors: number; warnings: number; text: string; skipped?: string };
    return typeof parsed.errors === "number" ? parsed : undefined;
  } catch (_e) {
    return undefined;
  }
}

export const ISSUE_SHAPE =
  "Every issue has a type and its sections as `### <section>` headings, each with text a newcomer understands: " +
  "Why, Context, What, then the type's own (Task: Done when; Decision: Options, Who decides; Epic: Outcome). A " +
  "Feature has Context, Problem, Expected value, Acceptance criteria; a Bug has Context, Steps to reproduce, " +
  "Observed behavior, Expected behavior, Additional context. `plan-me check-issue --skeleton --type <t>` prints them.";
const ISSUE_SKILL = "The working-with-plan-me skill shows how to write an issue that passes.";

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

/** The `repository` of a plan-me root's `.plan-me.json`, lower-case, or undefined when it has none or is unreadable. */
async function configRepo($: EngineInterface, root: string): Promise<string | undefined> {
  try {
    const raw = JSON.parse(`${await $.fs.read(`${root}/${CONFIG}`)}`) as { repository?: unknown };
    return typeof raw.repository === "string" ? raw.repository.toLowerCase() : undefined;
  } catch (_e) {
    return undefined;
  }
}

/** The issue check's memory for a session: bodies denied for warnings (pull-me's rule), the one toast. */
type IssueState = { warned: Set<string>; noted: boolean };

/** One toast per session when the issue check cannot run: a broken checker must not lock the session. */
function issueToast($: EngineInterface, state: IssueState, why: string): void {
  if (state.noted) return;
  state.noted = true;
  $.ui.toast(`plan-me: issue text not checked (${why}).`);
}

/** Runs the bundled issue check on a command's body; the denial text, or undefined to let the call through. */
async function checkBody(
  $: EngineInterface,
  state: IssueState,
  root: string,
  cwd: string,
  cmd: IssueCommand,
  what: string
): Promise<string | undefined> {
  let body = cmd.body;
  if (body === undefined && cmd.bodyFile && cmd.bodyFile !== "-") {
    try {
      body = `${await $.fs.read(cmd.bodyFile.startsWith("/") ? cmd.bodyFile : `${cwd}/${cmd.bodyFile}`)}`;
    } catch (_e) {
      return undefined; // the command reports an unreadable file itself
    }
  }
  if (cmd.shell) {
    issueToast($, state, "the body is built by the shell");
    return undefined;
  }
  const argv = ["node", `${$.plugin.root}/bundle/index.js`, "check-issue", "--stdin", "--format", "hook"];
  if (cmd.type) argv.push("--type", cmd.type);
  if (cmd.title !== undefined) argv.push("--title", cmd.title);
  const run = await $.process.run(argv, { cwd: root, stdin: body ?? "", timeoutMs: 120000 }).catch(() => undefined);
  const result = run ? parseHook(run.exitCode, run.stdout) : undefined;
  if (!result) {
    issueToast($, state, (run?.stderr || "node is not available").trim().split("\n")[0]);
    return undefined;
  }
  if (result.skipped && !/off$/.test(result.skipped)) issueToast($, state, result.skipped);
  if (result.errors > 0) {
    return (
      `plan-me: the issue text has ${result.errors} error(s) and ${result.warnings} warning(s), so ${what} was ` +
      `not run.\n\n${result.text}\n\n${ISSUE_SHAPE}\n${ISSUE_SKILL}`
    );
  }
  if (result.warnings > 0) {
    const key = bodyHash(`${cmd.type ?? ""}\n${body ?? ""}`);
    if (!state.warned.has(key)) {
      state.warned.add(key);
      return (
        `plan-me: the issue text passes, but has ${result.warnings} warning(s) a newcomer would trip over. ` +
        `${what} was not run yet.\n\n${result.text}\n\nFix them, or send the same body again to keep it as it ` +
        `is. ${ISSUE_SKILL}`
      );
    }
  }
  return undefined;
}

export const register: Register = on => {
  // The plan-me root per working directory: the nearest folder upwards with .plan-me.json (null: none).
  const roots = new Map<string, Promise<string | null>>();
  // One toast per session when the decisions check cannot run: a broken checker must not lock the session.
  let noted = false;
  // The issue check's memory: the bodies already denied for warnings, and whether its toast was shown.
  const issues: IssueState = { warned: new Set<string>(), noted: false };

  on("session.start", async ($, e, next) => {
    const started = await next(e);
    const root = await rootOf($, e.cwd, roots);
    if (root) $.ui.toast(START_NOTE);
    return started;
  });

  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    const issue = ghIssue(e.command);
    const commit = gitCommit(e.command);
    const planMeNew = parsePlanMeNew(e.command);
    if (!issue && !commit.commit && !planMeNew) return next(e);
    const cwd = await $.session.cwd();
    const root = await rootOf($, cwd, roots);
    if (!root) return next(e);
    if (issue) {
      // The guard is for the repository plan-me keeps; an issue on another repository is that repository's business.
      // Without a configured repository the guard cannot tell, so it keeps denying.
      const other = ghIssueRepo(e.command);
      const own = other ? await configRepo($, root) : undefined;
      if (other && own && other !== own) return next(e);
      const gh = parseGhIssue(e.command);
      const withBody = issue !== "close" && gh && (gh.body !== undefined || gh.bodyFile !== undefined);
      const found = withBody ? await checkBody($, issues, root, cwd, gh, `gh issue ${issue}`) : undefined;
      const text = found ? `\n\nThe body would also be refused:\n${found.replace(/^plan-me: /, "")}` : "";
      return { deny: `${DENY_ISSUE[issue]}${text}` };
    }
    if (planMeNew) {
      const denied = await checkBody($, issues, root, cwd, planMeNew, "`plan-me new`");
      if (denied) return { deny: denied };
      if (!commit.commit) return next(e);
    }

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

  on("tool.call", async ($, e, next) => {
    if (!MCP_NEW.test(e.tool)) return next(e);
    const cwd = await $.session.cwd();
    const root = await rootOf($, cwd, roots);
    if (!root) return next(e);
    const args = e as unknown as Record<string, unknown>;
    const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
    const cmd: IssueCommand = { title: str(args.title), type: str(args.type), body: str(args.body) ?? "" };
    const denied = await checkBody($, issues, root, cwd, cmd, "the MCP tool `new`");
    return denied ? { deny: denied } : next(e);
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
