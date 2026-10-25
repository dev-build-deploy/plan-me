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
        "- **rocks** · A big rock can hide the hero (point 3): include the rocks. Helper:",
        "  engine-dev.",
        "- **lab** · In progress (branch x-lab). The controller lab. Helper: feel-polish.",
        "## P2",
        "- **later** · Something later. Helper: user.",
      ].join("\n"),
    });
    const records = readLineList(CONFIG, path.join(dir, "backlog.md"));
    expect(records.map(r => [r.id, r.status, r.priority, r.role, r.title])).toEqual([
      ["old-thing", "done", "P1", undefined, "it shipped"],
      ["rocks", "open", "P1", "engine-dev", "A big rock can hide the hero (point 3)"],
      ["lab", "in-progress", "P1", "feel-polish", "The controller lab"],
      ["later", "open", "P2", "user", "Something later"],
    ]);
  });

  test("short titles", () => {
    expect(shortTitle("x".repeat(150)).length).toBeLessThanOrEqual(101);
    expect(shortTitle("One. Two.")).toBe("One");
  });
});

describe("runImport", () => {
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
