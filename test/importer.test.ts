/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import fs from "fs";
import os from "os";
import path from "path";

import { parseFrontMatter, readItemFolder, readLineList, runImport, shortTitle } from "../src/importer";

import { CONFIG, setup } from "./fake";

function tmp(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-me-"));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

const ITEM = (id: string, extra: string): string =>
  `---\nid: ${id}\ntitle: "Title ${id}"\npriority: P1\n${extra}\n---\n\n# Title ${id}\n\nBody of ${id}.\n`;

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
    expect(records[0].body).toBe("Body of child.\n\nDecisions: 16, 17");
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
    expect(records[0].body).toBe("(2026-10-01, branch feat/export) · Export the report as CSV.");
    expect(records[1].body).toContain("(also the API)");
    expect(records[4].body).toBe("A dark theme.");
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
    const dry = await runImport(backlog, readLineList(CONFIG, path.join(dir, "backlog.md")), { dryRun: true });
    expect(dry).toEqual(
      expect.arrayContaining([
        "blocked by export-pdf -> export-csv",
        'warn export-pdf: depends on "export-html", not an item in this file',
      ])
    );
    expect(dry.some(l => l.includes("-> export-html"))).toBe(false);
  });

  test("creates, links and is idempotent", async () => {
    const { api, backlog } = setup();
    const dir = tmp({
      "epic.md": ITEM("epic", "type: epic"),
      "a.md": ITEM("a", "type: feature\nparent: epic\nagent: helper"),
      "b.md": ITEM("b", "type: bug\nparent: epic\ndepends_on: [a, missing]"),
      "c.md": ITEM("c", "status: done"),
    });
    const records = readItemFolder(CONFIG, dir);
    const dry = await runImport(backlog, records, { dryRun: true });
    expect(dry.filter(l => l.startsWith("create"))).toHaveLength(3);
    expect(api.issues.size).toBe(0);

    const first = await runImport(backlog, records);
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

    const again = await runImport(backlog, records);
    expect(again.filter(l => !l.startsWith("exists") && !l.startsWith("warn"))).toEqual([]);
    expect(api.issues.size).toBe(3);

    await runImport(backlog, records, { done: "closed" });
    const c = await backlog.show("c");
    expect(c).toMatchObject({ open: false, status: "done" });
  });
});
