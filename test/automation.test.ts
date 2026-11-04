/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { findReferences, onIssueClosed, onIssueOpened, onPullRequest, PullRequestInfo, sweep } from "../src/automation";
import { Backlog } from "../src/backlog";
import { resolveConfig } from "../src/config";

import { CONFIG, FakeApi, setup } from "./fake";

/** A new Backlog on the same fake: the Action makes one per run, so no cache from the set-up carries over. */
const fresh = (api: FakeApi): Backlog => new Backlog(api, CONFIG);

const pr = (action: string, body: string, branch = "main", merged = false): PullRequestInfo => ({
  number: 99,
  action,
  merged,
  body,
  branch,
});

describe("findReferences", () => {
  test("keywords and branch", () => {
    expect(findReferences("Closes #1, fixes #2\nPart of #3 and part of #1", "feat/4-x", CONFIG.branchPattern)).toEqual({
      closes: [1, 2],
      partOf: [3],
      branch: [4],
    });
    expect(findReferences("", "12-thing", CONFIG.branchPattern).branch).toEqual([12]);
    expect(findReferences("", "v2-thing", CONFIG.branchPattern).branch).toEqual([]);
  });
});

describe("pull requests", () => {
  test("open: in-progress; merged: done for Closes and branch, Part of stays", async () => {
    const { api, backlog } = setup();
    for (const t of ["A", "B", "C"]) await backlog.create({ title: t });
    const opened = await onPullRequest(backlog, pr("opened", "Closes #1\nPart of #2", "feat/3-c"));
    expect(opened).toEqual(["#1 in-progress (#99)", "#2 in-progress (#99)", "#3 in-progress (#99)"]);
    expect(await onPullRequest(backlog, pr("synchronize", "Closes #1\nPart of #2", "feat/3-c"))).toEqual([]);

    const merged = await onPullRequest(backlog, pr("closed", "Closes #1\nPart of #2", "feat/3-c", true));
    expect(merged).toEqual(["#1 done (merged #99)", "#3 done (merged #99)"]);
    expect(api.issues.get(1)?.open).toBe(false);
    expect((await backlog.show(2)).status).toBe("in-progress");
    expect(await onPullRequest(backlog, pr("closed", "Closes #1", "x", true))).toEqual([]);
  });

  test("a branch named after a marker id", async () => {
    const { backlog } = setup();
    await backlog.create({ title: "A", id: "export-csv" });
    expect(await onPullRequest(backlog, pr("opened", "", "feat/export-csv"))).toEqual(["#1 in-progress (#99)"]);
  });

  test("closed without merge changes nothing", async () => {
    const { backlog } = setup();
    await backlog.create({ title: "A" });
    expect(await onPullRequest(backlog, pr("closed", "Closes #1", "x", false))).toEqual([]);
  });
});

describe("issues and schedule", () => {
  test("a closed blocker unblocks its dependents once", async () => {
    const { api, backlog } = setup();
    await backlog.create({ title: "Blocker" });
    await backlog.create({ title: "Dependent", blockedBy: ["1"] });
    await api.setOpen(1, false);
    const lines = await onIssueClosed(backlog, 1);
    expect(lines).toEqual(["#1 done", "#2 unblocked"]);
    expect((await backlog.show(2)).status).toBe("open");
    expect(api.comments.get(2)).toHaveLength(1);
    expect(await onIssueClosed(backlog, 1)).toEqual([]);
  });

  test("a close reads only the issues it blocked, never the whole backlog (native dependencies)", async () => {
    const { api, backlog } = setup();
    await backlog.create({ title: "Blocker" });
    await backlog.create({ title: "Other blocker" });
    await backlog.create({ title: "Free once 1 closes", blockedBy: ["1"] });
    await backlog.create({ title: "Still blocked by 2", blockedBy: ["1", "2"] });
    for (let k = 0; k < 20; k++) await backlog.create({ title: `Unrelated ${k}` });
    await api.setOpen(1, false);
    api.reads = 0;
    expect(await onIssueClosed(fresh(api), 1)).toEqual(["#1 done", "#3 unblocked"]);
    expect(api.reads).toBe(0);
    expect((await backlog.show(4)).status).toBe("blocked");
  });

  test("a close already marked done by the CLI changes nothing and reads nothing more", async () => {
    const { api, backlog } = setup();
    await backlog.create({ title: "Idea" });
    await backlog.done(1, "not planned");
    api.reads = 0;
    api.calls = [];
    expect(await onIssueClosed(fresh(api), 1)).toEqual([]);
    expect(api.reads).toBe(0);
    expect(api.calls).toEqual([]);
  });

  test("body-line blockers (no native dependencies): a close still sweeps the backlog", async () => {
    const api = new FakeApi({
      subIssues: false,
      dependencies: false,
      issueTypes: [],
      issueFieldsSupported: false,
      issueFields: [],
    });
    const backlog = new Backlog(api, CONFIG);
    await backlog.create({ title: "Blocker" });
    await backlog.create({ title: "Dependent", blockedBy: ["1"] });
    await api.setOpen(1, false);
    expect(await onIssueClosed(new Backlog(api, CONFIG), 1)).toEqual(["#1 done", "#2 unblocked"]);
  });

  test("an issue event sweeps that issue alone (native dependencies)", async () => {
    const { api } = setup();
    api.add({ title: "Bare", labels: ["component:engine"] });
    for (let k = 0; k < 5; k++) api.add({ title: `Bare ${k}`, labels: ["component:engine"] });
    api.reads = 0;
    expect(await sweep(fresh(api), [1])).toEqual(["#1 status open", "#1 priority medium"]);
    expect(api.reads).toBe(0);
  });

  test("missing priority gets the default and a comment; missing status becomes open", async () => {
    const { api, backlog } = setup();
    api.add({ title: "Bare", labels: ["component:engine"] });
    expect(await sweep(backlog)).toEqual(["#1 status open", "#1 priority medium"]);
    expect(api.comments.get(1)).toEqual(["plan-me: no priority set, defaulted to medium."]);
    expect(await sweep(backlog)).toEqual([]);
  });
});

describe("issues opened from a form", () => {
  /** A notes app: components api, web and mobile. */
  const notes = (): { api: FakeApi; backlog: Backlog } => {
    const api = new FakeApi();
    const config = resolveConfig({
      repository: "octo-org/notes",
      boards: { api: "API", web: "Web", mobile: "Mobile" },
      defaultComponent: "web",
      fields: { role: { options: ["lead", "backend", "frontend", "user"] } },
    });
    return { api, backlog: new Backlog(api, config) };
  };

  /** A body as GitHub writes a submitted issue form. */
  const formBody = (answers: Record<string, string>): string =>
    Object.entries(answers)
      .map(([label, answer]) => `### ${label}\n\n${answer}`)
      .join("\n\n");

  test("the answers become the component label and the board fields; rerunning changes nothing", async () => {
    const { api, backlog } = notes();
    const body = formBody({
      "Steps to reproduce": "1. Open a note",
      Component: "api",
      Priority: "High",
      Role: "backend",
      Effort: "_No response_",
    });
    api.add({ title: "Crash on open", body, issueType: "Bug" });
    expect(await onIssueOpened(backlog, 1)).toEqual(["#1 component api", "#1 priority - -> high; role - -> backend"]);
    expect(api.issues.get(1)?.labels).toEqual(["component:api"]);
    expect(api.issues.get(1)?.boards.API).toEqual({ Priority: "High", Role: "backend" });
    expect(await onIssueOpened(backlog, 1)).toEqual([]);
    expect(await sweep(backlog, [1])).toEqual(["#1 status open"]);
  });

  test("an existing component label wins; unknown answers are ignored; a decision opens as needs-decision", async () => {
    const { api, backlog } = notes();
    const body = formBody({ Question: "Sync or not?", Component: "api", Priority: "P9", Role: "nobody" });
    api.add({ title: "Sync?", body, labels: ["type:decision", "component:mobile"] });
    expect(await onIssueOpened(backlog, 1)).toEqual(["#1 needs-decision"]);
    expect(api.issues.get(1)?.labels).toEqual(["type:decision", "component:mobile"]);
    expect((await backlog.show(1)).status).toBe("needs-decision");
    expect(await onIssueOpened(backlog, 1)).toEqual([]);
  });

  test("an issue without form answers is left to the sweep", async () => {
    const { api, backlog } = notes();
    api.add({ title: "Blank", body: "Just text." });
    expect(await onIssueOpened(backlog, 1)).toEqual([]);
    expect(api.calls).toEqual([]);
  });
});
