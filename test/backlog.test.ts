/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { askBody } from "../src/backlog";
import { resolveConfig } from "../src/config";

import { CONFIG, setup } from "./fake";

describe("config", () => {
  test("defaults", () => {
    expect(CONFIG.owner).toBe("o");
    expect(CONFIG.fields.status.options["in-progress"]).toBe("In Progress");
    expect(CONFIG.fields.priority.default).toBe("medium");
    expect(Object.keys(CONFIG.fields.priority.options)).toEqual(["urgent", "high", "medium", "low"]);
    expect(CONFIG.fields.effort).toEqual({ name: "Effort", options: { high: "High", medium: "Medium", low: "Low" } });
    expect(CONFIG.boards.engine).toEqual({ title: "Engine", number: undefined });
  });

  test("errors", () => {
    expect(() => resolveConfig({})).toThrow(/repository/);
    expect(() => resolveConfig({ repository: "o/r", fields: { status: { options: { nope: "x" } } } })).toThrow(
      /unknown status/
    );
    expect(() => resolveConfig({ repository: "o/r", fields: { size: {} } } as never)).toThrow(/fields\.effort/);
    expect(() => resolveConfig({ repository: "o/r", fields: { priority: { default: "P2" } } })).toThrow(
      /default priority "P2"/
    );
  });

  test("Priority and Effort keys are their option names lower-cased; the default matches in any case", () => {
    const c = resolveConfig({ repository: "o/r", fields: { priority: { options: ["P1", "P2"], default: "P2" } } });
    expect(c.fields.priority).toEqual({ name: "Priority", options: { p1: "P1", p2: "P2" }, default: "p2" });
    const mapped = resolveConfig({ repository: "o/r", fields: { effort: { options: { s: "Small", l: "Large" } } } });
    expect(mapped.fields.effort.options).toEqual({ s: "Small", l: "Large" });
  });
});

describe("new", () => {
  test("labels, issue type fallback, fields, parent and blockers", async () => {
    const { api, backlog } = setup();
    const epic = await backlog.create({ title: "Epic", type: "Epic", component: "engine" });
    expect(api.issues.get(epic.item.number)?.labels).toEqual(["component:engine", "type:epic"]);
    const blocker = await backlog.create({ title: "Blocker", type: "bug" });
    expect(api.issues.get(blocker.item.number)?.issueType).toBe("Bug");
    const { item } = await backlog.create({
      title: "Child",
      component: "engine",
      priority: "high",
      role: "helper",
      parent: `#${epic.item.number}`,
      blockedBy: [String(blocker.item.number)],
      design: ["docs/design/x.md"],
    });
    expect(item).toMatchObject({ parent: epic.item.number, status: "blocked", priority: "high", role: "helper" });
    expect(item.blockedBy).toEqual([blocker.item.number]);
    expect(api.issues.get(item.number)?.body).toContain("(https://github.com/o/r/blob/HEAD/docs/design/x.md)");
  });

  test("is idempotent with an id", async () => {
    const { api, backlog } = setup();
    const a = await backlog.create({ title: "A", id: "item-a" });
    const b = await backlog.create({ title: "A", id: "item-a" });
    expect(b.changed).toBe(false);
    expect(b.item.number).toBe(a.item.number);
    expect(api.issues.size).toBe(1);
    expect(await backlog.resolve("item-a")).toBe(a.item.number);
  });

  test("rejects unknown keys before creating", async () => {
    const { api, backlog } = setup();
    await expect(backlog.create({ title: "A", priority: "P9" })).rejects.toThrow(/unknown priority/);
    await expect(backlog.create({ title: "A", component: "nope" })).rejects.toThrow(/unknown component/);
    expect(api.issues.size).toBe(0);
  });
});

describe("status commands", () => {
  test("start, decide, done are idempotent", async () => {
    const { api, backlog } = setup();
    const { item } = await backlog.create({ title: "A" });
    const started = await backlog.start(item.number, "feat/1-a");
    expect(started.item.status).toBe("in-progress");
    expect(api.issues.get(item.number)?.body).toContain("Branch: feat/1-a");
    expect((await backlog.start(item.number, "feat/1-a")).changed).toBe(false);

    const decided = await backlog.decide(item.number, "Which one?");
    expect(decided.item.status).toBe("needs-decision");
    expect((await backlog.decide(item.number, "Which one?")).changed).toBe(false);
    expect(api.comments.get(item.number)).toHaveLength(1);

    const done = await backlog.done(item.number, "Shipped.");
    expect(done.item).toMatchObject({ status: "done", open: false });
    expect((await backlog.done(item.number, "Shipped.")).changed).toBe(false);
    expect(api.comments.get(item.number)).toEqual(["**Needs decision:** Which one?", "**Done.** Shipped."]);
  });

  test("block sets blocked only while the blocker is open", async () => {
    const { backlog } = setup();
    const a = await backlog.create({ title: "A" });
    const b = await backlog.create({ title: "B" });
    const blocked = await backlog.block(a.item.number, b.item.number);
    expect(blocked.item).toMatchObject({ status: "blocked", blockedBy: [b.item.number] });
    expect((await backlog.block(a.item.number, b.item.number)).changed).toBe(false);
    await expect(backlog.block(a.item.number, a.item.number)).rejects.toThrow(/itself/);
  });

  test("setStatus reopens a closed item", async () => {
    const { api, backlog } = setup();
    const { item } = await backlog.create({ title: "A" });
    await backlog.done(item.number);
    const reopened = await backlog.setStatus(item.number, "open");
    expect(reopened.actions).toContain("reopened");
    expect(api.issues.get(item.number)?.open).toBe(true);
  });
});

describe("next, list and snapshot", () => {
  async function fill(): Promise<ReturnType<typeof setup>> {
    const s = setup();
    const b = s.backlog;
    const epic = await b.create({ title: "Epic", type: "Epic", priority: "high" }); // #1
    await b.create({ title: "Open high", priority: "high", parent: "1", role: "helper" }); // #2
    const ip = await b.create({ title: "In progress high", priority: "high", parent: "1" }); // #3
    await b.start(ip.item.number);
    const nd = await b.create({ title: "Needs decision high", priority: "high", role: "user" }); // #4
    await b.decide(nd.item.number);
    await b.create({ title: "Blocked high", priority: "high", blockedBy: ["2"], component: "engine" }); // #5
    await b.create({ title: "low", priority: "low" }); // #6
    await b.create({ title: "medium engine", priority: "medium", component: "engine" }); // #7
    expect(epic.item.number).toBe(1);
    return s;
  }

  test("next: priority, then in-progress and needs-decision first; skips blocked and epics", async () => {
    const { backlog } = await fill();
    const order = (await backlog.next({}, 10)).map(i => i.number);
    expect(order).toEqual([3, 4, 2, 7, 6]);
    expect((await backlog.next({ component: "engine" })).map(i => i.number)).toEqual([7]);
    expect((await backlog.next({ role: "helper" })).map(i => i.number)).toEqual([2]);
  });

  test("list filters", async () => {
    const { backlog } = await fill();
    expect((await backlog.list({ parent: 1 })).map(i => i.number)).toEqual([3, 2]);
    expect((await backlog.list({ status: "blocked" })).map(i => i.number)).toEqual([5]);
    expect((await backlog.list({ type: "epic" })).map(i => i.number)).toEqual([1]);
  });

  test("a closed blocker no longer blocks next", async () => {
    const { backlog } = await fill();
    await backlog.done(2);
    const item = (await backlog.list({})).find(i => i.number === 5);
    expect(item?.blockedBy).toEqual([]);
  });

  test("snapshot", async () => {
    const { backlog } = await fill();
    expect(await backlog.snapshot()).toBe(
      [
        "# plan-me snapshot o/r: 7 open items",
        "## engine",
        "#5 [engine high blocked] Blocked high — blocked by #2",
        "#7 [engine medium open] medium engine",
        "## game",
        "#4 [game high needs-decision user] Needs decision high",
        "#1 [game high open epic] Epic",
        "  #3 [game high in-progress] In progress high",
        "  #2 [game high open helper] Open high",
        "#6 [game low open] low",
        "",
      ].join("\n")
    );
  });

  test("init creates labels and boards once", async () => {
    const { backlog } = setup();
    const first = await backlog.init(false);
    expect(first).toEqual(
      expect.arrayContaining(["create label component:engine", "create label type:epic", 'create board "Engine"'])
    );
    expect(first).not.toContain("create label type:feature");
    expect(await backlog.init(false)).toEqual([]);
  });
});

describe("askBody", () => {
  test("a new question gets the Decision sections, the question under What", () => {
    const body = askBody("Decision", "Two pricing tiers or three?") ?? "";
    expect(body).toMatch(/^### Why\n\n<!--/);
    expect(body).toContain("### What\n\nTwo pricing tiers or three?\n\n### Options");
    expect(body).toContain("### Who decides");
    expect(askBody(undefined, "Two or three?")).toBe("Two or three?");
    expect(askBody("Decision", undefined)).toContain("### What\n\n<!--");
  });
});

describe("issue fields (a repository of an organization)", () => {
  const orgFeatures = {
    subIssues: true,
    dependencies: true,
    issueTypes: ["Feature", "Bug", "Task"],
    issueFieldsSupported: true,
    issueFields: [],
  };

  test("init creates the issue fields; the boards get Status and Role only", async () => {
    const { api, backlog } = setup(orgFeatures);
    const first = await backlog.init(true);
    expect(first).toEqual(expect.arrayContaining(['create issue field "Priority"', 'create issue field "Effort"']));
    expect(api.orgFields.size).toBe(0);
    await backlog.init(false);
    expect(api.orgFields.get("Priority")).toEqual(["Urgent", "High", "Medium", "Low"]);
    expect([...(api.boards.get("Engine") ?? [])]).toEqual(["Status", "Role"]);
    expect(await backlog.init(false)).toEqual([]);
  });

  test("Priority and Effort are written to and read from the issue fields, the rest to the board", async () => {
    const { api, backlog } = setup(orgFeatures);
    await backlog.init(false);
    const { item } = await backlog.create({ title: "A", priority: "high", effort: "low", role: "lead" });
    const raw = api.issues.get(item.number);
    expect(raw?.issueFields).toEqual({ Priority: "High", Effort: "Low" });
    expect(raw?.boards.Game).toEqual({ Status: "Todo", Role: "lead" });
    expect(item).toMatchObject({ priority: "high", effort: "low", role: "lead", status: "open" });
    const updated = await backlog.update(item.number, { priority: "urgent" });
    expect(updated.actions).toEqual(["priority high -> urgent"]);
    expect(api.calls.at(-1)).toBe(`issue fields #${item.number} {"Priority":"Urgent"}`);
    expect((await backlog.update(item.number, { priority: "urgent" })).changed).toBe(false);
  });

  test("a board-only repository keeps Priority and Effort on the board", async () => {
    const { api, backlog } = setup();
    const { item } = await backlog.create({ title: "A", priority: "low", effort: "high" });
    expect(api.issues.get(item.number)?.boards.Game).toEqual({ Status: "Todo", Priority: "Low", Effort: "High" });
    expect(item).toMatchObject({ priority: "low", effort: "high" });
  });
});
