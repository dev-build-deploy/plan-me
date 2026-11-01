// SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
// SPDX-License-Identifier: MIT

import { expect, test } from "claude-code/testing";

import { decisionChanges, ghIssue, gitCommit, relative } from "./register";

const ROOT = "/private/tmp/plan-me-plugin-test";
const FORM = "# plan-me:sha256=abc\nname: Bug\n";

type Opts = {
  /** Files that exist (absolute path -> text). */
  files?: Record<string, string>;
  cwd?: string;
  /** `git status --porcelain` output for the decision paths. */
  status?: string;
  /** What `decisions check` answers. */
  check?: { exitCode: number; stdout: string; stderr?: string };
};

// Stands for the engine beneath the plugin: the file system, the working directory and the processes. The real
// decisions check is covered by the jest suite in test/; here we test what the hooks do with its answers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function setup($: any, on: any, opts: Opts = {}) {
  const files: Record<string, string> = { [`${ROOT}/.plan-me.json`]: "{}", [`${ROOT}/.git`]: "", ...opts.files };
  const cwd = opts.cwd ?? ROOT;
  let reached: unknown;
  const runs: string[][] = [];
  const toasts: string[] = [];
  on("tool.call", (_: unknown, e: unknown) => {
    reached = e;
    return { result: {} };
  });
  on("session.start", (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }));
  on("session.cwd", () => ({ value: cwd }));
  on("fs.exists", (_: unknown, e: { path: string }) => ({ value: e.path in files }));
  on("fs.read", (_: unknown, e: { path: string }) => {
    if (!(e.path in files)) throw new Error("ENOENT");
    return { value: files[e.path] };
  });
  on("ui.toast", (_: unknown, e: { text: string }) => {
    toasts.push(e.text);
    return { value: undefined };
  });
  on("process.run", (_: unknown, e: { argv: string[] }) => {
    runs.push(e.argv);
    const r =
      e.argv[0] === "git"
        ? { exitCode: 0, stdout: opts.status ?? "", stderr: "" }
        : { stderr: "", ...(opts.check ?? { exitCode: 0, stdout: "ok" }) };
    return { value: { ...r, isStdoutTruncated: false, isStderrTruncated: false } };
  });
  await $.session.start({ cwd, surface: "terminal", isInteractive: true });
  return {
    runs,
    toasts,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    call: async (args: any) => {
      reached = undefined;
      const r = await $.tool.call(args);
      return { text: JSON.stringify(r), reached };
    },
  };
}

const bash = (command: string) => ({ tool: "Bash", command });

test("gh issue create, new, edit and close are denied with the plan-me command to use", async ($, on) => {
  const t = await setup($, on);
  const create = await t.call(bash('gh issue create --title "Dark mode" --body x'));
  expect(create.reached).toBeUndefined();
  expect(create.text).toContain("plan-me new");
  expect((await t.call(bash("gh issue new -t x"))).text).toContain("plan-me new");
  expect((await t.call(bash("gh issue edit 12 --add-label bug"))).text).toContain("plan-me start");
  expect((await t.call(bash("cd web && gh -R octo-org/notes issue close 12"))).text).toContain("plan-me done");
});

test("gh issue view, list and comment pass, and so does a mention in text", async ($, on) => {
  const t = await setup($, on);
  for (const command of [
    "gh issue view 12",
    "gh issue list",
    'gh issue comment 12 --body "x"',
    "echo gh issue create",
  ]) {
    expect((await t.call(bash(command))).reached).toBeDefined();
  }
});

test("outside a plan-me repository everything passes", async ($, on) => {
  const t = await setup($, on, { cwd: "/elsewhere", files: { "/elsewhere/.git": "" } });
  expect((await t.call(bash("gh issue create -t x"))).reached).toBeDefined();
  expect(
    (await t.call({ tool: "Write", file_path: "/elsewhere/docs/decisions.md", content: "x" })).reached
  ).toBeDefined();
  expect(t.toasts).toEqual([]);
});

test("the session starts with one toast naming snapshot and next", async ($, on) => {
  const t = await setup($, on, { cwd: `${ROOT}/web/src` });
  expect(t.toasts).toHaveLength(1);
  expect(t.toasts[0]).toContain("plan-me snapshot --out");
  expect(t.toasts[0]).toContain("plan-me next");
});

test("the generated decisions index is never written by hand", async ($, on) => {
  const t = await setup($, on, { cwd: `${ROOT}/docs` });
  const write = await t.call({ tool: "Write", file_path: `${ROOT}/docs/decisions.md`, content: "x" });
  expect(write.reached).toBeUndefined();
  expect(write.text).toContain("plan-me decide");
  const edit = await t.call({ tool: "Edit", file_path: "decisions.md", old_string: "a", new_string: "b" });
  expect(edit.reached).toBeUndefined();
  const file = { tool: "Write", file_path: `${ROOT}/docs/decisions/2026-11-01-x.md`, content: "x" };
  expect((await t.call(file)).reached).toBeDefined();
});

test("a generated issue form is denied; a hand-made one passes", async ($, on) => {
  const t = await setup($, on, {
    files: {
      [`${ROOT}/.github/ISSUE_TEMPLATE/bug.yml`]: FORM,
      [`${ROOT}/.github/ISSUE_TEMPLATE/own.yml`]: "name: Own\n",
    },
  });
  const gen = await t.call({
    tool: "Edit",
    file_path: `${ROOT}/.github/ISSUE_TEMPLATE/bug.yml`,
    old_string: "a",
    new_string: "b",
  });
  expect(gen.reached).toBeUndefined();
  expect(gen.text).toContain("plan-me templates");
  const own = { tool: "Edit", file_path: `${ROOT}/.github/ISSUE_TEMPLATE/own.yml`, old_string: "a", new_string: "b" };
  expect((await t.call(own)).reached).toBeDefined();
});

test("git commit with staged decision files runs the check and is denied on problems", async ($, on) => {
  const problems = "docs/decisions.md: stale or edited by hand (line 3); run `plan-me decisions index`";
  const t = await setup($, on, {
    status: "A  docs/decisions/2026-11-01-x.md\n",
    check: { exitCode: 1, stdout: problems },
  });
  const r = await t.call(bash('git commit -m "docs(decisions): x"'));
  expect(r.reached).toBeUndefined();
  expect(r.text).toContain("stale or edited by hand");
  expect(t.runs[1]).toEqual(expect.arrayContaining(["decisions", "check"]));
});

test("git commit passes when the check passes, or nothing in the decisions is staged", async ($, on) => {
  const t = await setup($, on, {
    status: " M docs/decisions/2026-11-01-x.md\n",
    check: { exitCode: 1, stdout: "bad" },
  });
  expect((await t.call(bash('git commit -m "x"'))).reached).toBeDefined(); // unstaged only
  expect(t.runs).toHaveLength(1);
  expect((await t.call(bash('git commit -am "x"'))).reached).toBeUndefined(); // -a stages it
  expect((await t.call(bash('git add docs && git commit -m "x"'))).reached).toBeUndefined();
});

test("a checker that cannot run does not lock the session", async ($, on) => {
  const t = await setup($, on, {
    status: "M  docs/decisions.md\n",
    check: { exitCode: 127, stdout: "", stderr: "node: not found" },
  });
  expect((await t.call(bash('git commit -m "x"'))).reached).toBeDefined();
  expect(t.toasts.at(-1)).toContain("decisions not checked");
});

test("the parsers", () => {
  expect(ghIssue("gh issue create")).toBe("create");
  expect(ghIssue("x; gh --repo=o/r issue edit 3")).toBe("edit");
  expect(ghIssue("gh issue view 3")).toBeUndefined();
  expect(ghIssue("gh issues")).toBeUndefined();
  expect(gitCommit("git -C web commit --amend")).toEqual({ commit: true, stages: false });
  expect(gitCommit("git commit --all -m x").stages).toBe(true);
  expect(gitCommit("git log").commit).toBe(false);
  expect(decisionChanges("?? docs/decisions/a.md\n", false)).toBe(false);
  expect(decisionChanges("?? docs/decisions/a.md\n", true)).toBe(true);
  expect(relative("/r", "/r/docs", "../docs/./decisions.md")).toBe("docs/decisions.md");
  expect(relative("/r", "/r", "/other/x")).toBeUndefined();
});
