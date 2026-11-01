/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import fs from "fs";
import os from "os";
import path from "path";

import {
  importRefused,
  parseFrontMatter,
  readItemFolder,
  readLineList,
  runImport,
  shortTitle,
  updatedBody,
} from "../src/importer";
import { sectionsFor } from "../src/templates";
import { ValeFinding } from "../src/vale";

import { CONFIG, setup } from "./fake";

function tmp(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-me-"));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

/** A body with every section of a type, each with a sentence (`##` headings: the importer writes them as `###`). */
const SECTIONS = (type: string, id: string): string =>
  sectionsFor(type)
    .map(s => `## ${s.label}\n\n${s.label} of ${id}.`)
    .join("\n\n");

const ITEM = (id: string, extra: string, type = /type: (\w+)/.exec(extra)?.[1] ?? "task"): string =>
  `---\nid: ${id}\ntitle: "Title ${id}"\npriority: P1\n${extra}\n---\n\n# Title ${id}\n\n${SECTIONS(type, id)}\n`;

/** The issue check without Vale: the structure rules only (the prose rules have their own tests). */
const NO_VALE = { root: os.tmpdir(), vale: false };

describe("adapters", () => {
  test("front matter", () => {
    const { data, content } = parseFrontMatter(
      '---\nid: a\ndesign: [design/x.md, "y.md"]\nstatus: open   # comment\ndepends_on: []\n---\nbody'
    );
    expect(data).toEqual({ id: "a", design: ["design/x.md", "y.md"], status: "open", depends_on: [] });
    expect(content).toBe("body");
  });

  test("folder of item files", () => {
    const dir = tmp({
      "epic.md": ITEM("epic", "type: epic\narea: engine"),
      "child.md": ITEM(
        "child",
        'type: chore\nparent: epic\nagent: feature-dev\ndesign: [design/x.md]\ndecisions: "16, 17"'
      ),
      "notes.txt": "ignored",
    });
    const records = readItemFolder(CONFIG, dir, { component: "game" });
    expect(records.map(r => r.id)).toEqual(["child", "epic"]);
    expect(records[0]).toMatchObject({
      type: "Task",
      parent: "epic",
      role: "feature-dev",
      component: "game",
      design: ["docs/design/x.md"],
    });
    expect(records[0].body).toMatch(/^### Why\n\nWhy of child\.\n\n### Context/);
    expect(records[0].body).toMatch(/What of child\.\n\nDecisions: 16, 17$/);
    expect(records[1]).toMatchObject({ type: "Epic", component: "engine", priority: "P1" });
  });

  test("line list", () => {
    const dir = tmp({
      "backlog.md": [
        "# Backlog",
        "## P1",
        "- ~~old-thing~~ done (2026-10-23): it shipped.",
        "- **rocks** · A long note can hide the toolbar (point 3): include the notes. Helper:",
        "  backend.",
        "- **lab** · In progress (branch x-lab). The toolbar prototype. Helper: frontend.",
        "## P2",
        "- **later** · Something later. Helper: user.",
      ].join("\n"),
    });
    const records = readLineList(CONFIG, path.join(dir, "backlog.md"));
    expect(records.map(r => [r.id, r.status, r.priority, r.role, r.title])).toEqual([
      ["old-thing", "done", "P1", undefined, "it shipped"],
      ["rocks", "open", "P1", "backend", "A long note can hide the toolbar (point 3)"],
      ["lab", "in-progress", "P1", "frontend", "The toolbar prototype"],
      ["later", "open", "P2", "user", "Something later"],
    ]);
  });

  test("line list: a Done section", () => {
    const dir = tmp({
      "backlog.md": [
        "## P3",
        "- **dark-mode** · A dark theme for the settings page.",
        "## Done",
        "- **login-timeout** · Sessions expired after 5 minutes.",
        "## P1",
        "- **export-csv** · Export the report as CSV.",
      ].join("\n"),
    });
    const records = readLineList(CONFIG, path.join(dir, "backlog.md"));
    expect(records.map(r => [r.id, r.status, r.priority])).toEqual([
      ["dark-mode", "open", "P3"],
      ["login-timeout", "done", "P3"],
      ["export-csv", "open", "P1"],
    ]);
  });

  test("line list: meta after the id", () => {
    const dir = tmp({
      "backlog.md": [
        "## P2",
        "- **export-csv** (2026-10-01, branch feat/export) · Export the report as CSV.",
        "- **login-timeout** (2026-10-02, branch fix/login (also the API)) · Sessions expire too soon.",
        "- **search-filters** + **search-sort** (2026-10-03, branch feat/search) · Filters and sorting on search.",
        "- **pricing-tiers** (draft): Two tiers or three.",
        "- **dark-mode** - A dark theme.",
      ].join("\n"),
    });
    const records = readLineList(CONFIG, path.join(dir, "backlog.md"));
    expect(records.map(r => [r.id, r.title])).toEqual([
      ["export-csv", "Export the report as CSV"],
      ["login-timeout", "Sessions expire too soon"],
      ["search-filters", "Filters and sorting on search"],
      ["pricing-tiers", "Two tiers or three"],
      ["dark-mode", "A dark theme"],
    ]);
    expect(records[0].body).toBe("### What\n\n(2026-10-01, branch feat/export) · Export the report as CSV.");
    expect(records[1].body).toContain("(also the API)");
    expect(records[4].body).toBe("### What\n\nA dark theme.");
  });

  test("line list: an item's own priority", () => {
    const dir = tmp({
      "backlog.md": [
        "## P1",
        "- **dark-mode** · P3 · A dark theme for the settings page.",
        "- **login-timeout** · P2 (found by a test bot): Sessions expire too soon.",
        "- **export-csv** (2026-10-01) · P3: Export the report as CSV.",
        "- **pricing-tiers** · Pricing in tiers.",
      ].join("\n"),
    });
    const records = readLineList(CONFIG, path.join(dir, "backlog.md"));
    expect(records.map(r => [r.id, r.priority, r.title])).toEqual([
      ["dark-mode", "P3", "A dark theme for the settings page"],
      ["login-timeout", "P2", "Sessions expire too soon"],
      ["export-csv", "P3", "Export the report as CSV"],
      ["pricing-tiers", "P1", "Pricing in tiers"],
    ]);
    expect(records[1].body).toContain("(found by a test bot)");
  });

  test("line list: status phrases", () => {
    const dir = tmp({
      "backlog.md": [
        "## P1",
        "- **pricing-tiers** · Needs a decision. Two tiers or three? Helper: designer.",
        "- **pricing-page** · Needs decision: Which plan is the default.",
        "- **export-pdf** · Blocked. The PDF library is not chosen.",
        "- **export-xls** · Blocked by export-pdf, pricing-page. The same report as a spreadsheet.",
        "- **sync-notes** · In progress (branch feat/sync). Notes sync between devices.",
        "- **print-view** · Blocked by the print library: A print layout.",
      ].join("\n"),
    });
    const records = readLineList(CONFIG, path.join(dir, "backlog.md"));
    expect(records.map(r => [r.id, r.status, r.title])).toEqual([
      ["pricing-tiers", "needs-decision", "Two tiers or three?"],
      ["pricing-page", "needs-decision", "Which plan is the default"],
      ["export-pdf", "blocked", "The PDF library is not chosen"],
      ["export-xls", "blocked", "The same report as a spreadsheet"],
      ["sync-notes", "in-progress", "Notes sync between devices"],
      ["print-view", "blocked", "A print layout"],
    ]);
  });

  test("line list: dependencies", () => {
    const dir = tmp({
      "backlog.md": [
        "## P1",
        "- **export-csv** · Export the report as CSV.",
        "- **pricing-page** · The plans side by side.",
        "- **export-pdf** · After export-csv: the same report as PDF.",
        "- **export-xls** · Blocked by export-csv, pricing-page. The report as a spreadsheet.",
        "- **share-link** · After export-csv and export-html: a link to the report. Depends on the new API.",
        "- **after-lunch** · After lunch: a short break.",
      ].join("\n"),
    });
    const records = readLineList(CONFIG, path.join(dir, "backlog.md"));
    expect(records.map(r => [r.id, r.status, r.title, r.dependsOn, r.warnings])).toEqual([
      ["export-csv", "open", "Export the report as CSV", [], []],
      ["pricing-page", "open", "The plans side by side", [], []],
      ["export-pdf", "open", "The same report as PDF", ["export-csv"], []],
      ["export-xls", "blocked", "The report as a spreadsheet", ["export-csv", "pricing-page"], []],
      [
        "share-link",
        "open",
        "A link to the report",
        ["export-csv"],
        ['depends on "export-html", not an item in this file'],
      ],
      ["after-lunch", "open", "After lunch: a short break", [], []],
    ]);
  });

  test("line list: After anywhere", () => {
    const dir = tmp({
      "backlog.md": [
        "## P1",
        "- **export-csv** · Export the report as CSV.",
        "- **export-pdf** · The report as PDF, the most used first. After export-csv. Helper: backend.",
        "- **export-xls** · After export-csv (if the owner keeps it): the report as a spreadsheet.",
        "- **share-link** · A link to the report. After export-html, or after lunch.",
      ].join("\n"),
    });
    const records = readLineList(CONFIG, path.join(dir, "backlog.md"));
    expect(records.map(r => [r.id, r.title, r.dependsOn, r.warnings])).toEqual([
      ["export-csv", "Export the report as CSV", [], []],
      ["export-pdf", "The report as PDF, the most used first", ["export-csv"], []],
      ["export-xls", "The report as a spreadsheet", ["export-csv"], []],
      ["share-link", "A link to the report", [], []],
    ]);
    expect(records[1].role).toBe("backend");
  });

  test("short titles", () => {
    expect(shortTitle("x".repeat(150)).length).toBeLessThanOrEqual(101);
    expect(shortTitle("One. Two.")).toBe("One");
    expect(shortTitle("One? Two.")).toBe("One?");
  });
});

describe("runImport", () => {
  test("line-list dependencies and warnings in the dry run", async () => {
    const { backlog } = setup();
    const dir = tmp({
      "backlog.md": [
        "## P1",
        "- **export-csv** · Export the report as CSV.",
        "- **export-pdf** · After export-csv, export-html: the same report as PDF.",
      ].join("\n"),
    });
    const records = readLineList(CONFIG, path.join(dir, "backlog.md"));
    expect(records[1].dependsOn).toEqual(["export-csv"]);
    // A line only fills What and carries no type: the issue check refuses every record, and says why.
    const dry = await runImport(backlog, records, { dryRun: true, check: NO_VALE });
    expect(dry).toEqual(
      expect.arrayContaining([
        "refuse export-csv: 1 error(s)",
        expect.stringContaining("[PI001] The issue has no type."),
        'warn export-pdf: depends on "export-html", not an item in this file',
      ])
    );
    expect(dry.some(l => l.startsWith("create"))).toBe(false);
    expect(importRefused(dry)).toBe(true);
  });

  test("creates, links and is idempotent", async () => {
    const { api, backlog } = setup();
    const dir = tmp({
      "epic.md": ITEM("epic", "type: epic"),
      "a.md": ITEM("a", "type: feature\nparent: epic\nagent: helper"),
      "b.md": ITEM("b", "type: bug\nparent: epic\ndepends_on: [a, missing]"),
      "c.md": ITEM("c", "type: task\nstatus: done"),
    });
    const records = readItemFolder(CONFIG, dir);
    const dry = await runImport(backlog, records, { dryRun: true, check: NO_VALE });
    expect(dry.filter(l => l.startsWith("create"))).toHaveLength(3);
    expect(api.issues.size).toBe(0);

    const first = await runImport(backlog, records, { check: NO_VALE });
    expect(first).toEqual(
      expect.arrayContaining([
        "created #1 a",
        "parent #1 -> #3",
        "blocked by #2 -> #1",
        'warn b: blocked by "missing" not found',
      ])
    );
    expect(api.issues.size).toBe(3);
    const b = await backlog.show("b");
    expect(b).toMatchObject({ status: "blocked", parent: 3, blockedBy: [1], type: "Bug" });
    expect(b.body).toContain("<!-- plan-me:id=b -->");

    const again = await runImport(backlog, records, { check: NO_VALE });
    expect(again.filter(l => !l.startsWith("exists") && !l.startsWith("warn"))).toEqual([]);
    expect(api.issues.size).toBe(3);

    await runImport(backlog, records, { done: "closed", check: NO_VALE });
    const c = await backlog.show("c");
    expect(c).toMatchObject({ open: false, status: "done" });
  });
});

describe("the issue check on import", () => {
  test("a record without its sections is refused, the others are created; dry runs list the problems", async () => {
    const { api, backlog } = setup();
    const dir = tmp({
      "good.md": ITEM("good", "type: task"),
      "bad.md": "---\nid: bad\ntitle: Notes\ntype: feature\n---\n\nsome working notes\n",
      "untyped.md": ITEM("untyped", "status: open"),
    });
    const records = readItemFolder(CONFIG, dir);
    const dry = await runImport(backlog, records, { dryRun: true, check: NO_VALE });
    expect(dry).toEqual(
      expect.arrayContaining([
        "refuse bad: 1 error(s)",
        expect.stringMatching(/^ {2}line 1: error: \[PI004\] The body has no sections/),
        "refuse untyped: 1 error(s)",
        "create good [P1 open] Title good",
      ])
    );
    const lines = await runImport(backlog, records, { check: NO_VALE });
    expect(lines).toContain("created #1 good");
    expect(api.issues.size).toBe(1);
    expect(importRefused(lines)).toBe(true);
    expect((await backlog.show("good")).body).toContain("### Why\n\nWhy of good.");
  });

  test("the prose findings are warnings: the record is created with warn lines", async () => {
    const { backlog } = setup();
    const dir = tmp({ "a.md": ITEM("a", "type: task") });
    const vale = async (bodies: string[]): Promise<ValeFinding[][]> =>
      bodies.map(() => [{ rule: "DevBuildDeploy.Weasel", line: 3, column: 1, message: "'very' weakens it" }]);
    const lines = await runImport(backlog, readItemFolder(CONFIG, dir), { check: { root: os.tmpdir(), vale } });
    expect(lines).toEqual(["created #1 a", "warn a: line 3: warning: [DevBuildDeploy.Weasel] 'very' weakens it"]);
  });

  test("--update rewrites the title, body and type of an existing issue, keeping the lines added since", async () => {
    const { api, backlog } = setup();
    const raw = api.add({
      title: "notes",
      body: "some working notes\n\n<!-- plan-me:id=a -->\n\nParent: #7\n",
    });
    const dir = tmp({ "a.md": ITEM("a", "type: bug") });
    const records = readItemFolder(CONFIG, dir);
    expect(await runImport(backlog, records, { check: NO_VALE })).toContain(`exists #${raw.number} a`);
    const dry = await runImport(backlog, records, { update: true, dryRun: true, check: NO_VALE });
    expect(dry).toContain(`update #${raw.number} a: title, body, type`);
    expect(api.issues.get(raw.number)?.title).toBe("notes");

    const lines = await runImport(backlog, records, { update: true, check: NO_VALE });
    expect(lines[0]).toMatch(new RegExp(`^updated #${raw.number} a: title; body; type; priority - -> P1`));
    const after = api.issues.get(raw.number);
    expect(after).toMatchObject({ title: "Title a", issueType: "Bug" });
    expect(after?.body).toContain("### Steps to reproduce\n\nSteps to reproduce of a.");
    expect(after?.body).toContain("<!-- plan-me:id=a -->");
    expect(after?.body).toMatch(/Parent: #7\n$/);
    expect(await runImport(backlog, records, { update: true, check: NO_VALE })).toEqual([`exists #${raw.number} a`]);
  });

  test("--update refuses a record that fails the check and leaves the issue alone", async () => {
    const { api, backlog } = setup();
    const raw = api.add({ title: "notes", body: "x\n\n<!-- plan-me:id=a -->\n" });
    const dir = tmp({ "a.md": "---\nid: a\ntitle: Better\ntype: task\n---\n\nstill notes\n" });
    const lines = await runImport(backlog, readItemFolder(CONFIG, dir), { update: true, check: NO_VALE });
    expect(lines[0]).toBe("refuse a: 1 error(s)");
    expect(api.issues.get(raw.number)?.title).toBe("notes");
  });

  test("updatedBody keeps the lines plan-me and pull requests add", () => {
    const current = "old\n\nBranch: feat/1-x\n\nBlocked by #3\n\n- [ ] #9\n\nDecision: docs/decisions/a.md\n";
    expect(updatedBody("new\n", current)).toBe(
      "new\n\nBranch: feat/1-x\n\nBlocked by #3\n\n- [ ] #9\n\nDecision: docs/decisions/a.md\n"
    );
  });
});
