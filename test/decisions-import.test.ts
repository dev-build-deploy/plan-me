/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

import { COMMANDS } from "../src/commands";
import { checkDecisions, formatDecision, readDecisions } from "../src/decisions";
import { findChanges, importDecisions, ListEntry, parseDecisionList, toDecisions } from "../src/decisions-import";

import { repo } from "./repo";

const FIXTURES = path.join(__dirname, "fixtures", "decisions");
const fixture = (name: string): string => fs.readFileSync(path.join(FIXTURES, name), "utf8");

/** The entry with a label (throws when missing). */
function entry(list: ListEntry[], number: string): ListEntry {
  const found = list.find(e => e.number === number);
  if (!found) throw new Error(`no entry ${number}`);
  return found;
}

/** A repository holding a numbered list and an app's labelled list where a monorepo keeps them. */
function monorepo(): string {
  return repo({
    "docs/decisions.md": fixture("numbered.md"),
    "apps/web/docs/decisions.md": fixture("labelled.md"),
  });
}

describe("numbered lists (docs/decisions.md)", () => {
  const list = parseDecisionList(fixture("numbered.md"), "numbered");

  test("entries, titles, dates from the parentheses or the heading, by", () => {
    expect(list).toHaveLength(28);
    expect(list[0]).toMatchObject({ number: "1", date: "2026-10-10", title: "Notes sync only over the account" });
    expect(list[0].by).toBeUndefined();
    expect(list[0].text).toMatch(/^\*\*Notes sync only over the account:\*\* no peer-to-peer sync between devices; the/);
    expect(list[0].text).toContain("\nhistory) goes through the account's server in the sync service.");
    expect(list.find(e => e.number === "4")).toMatchObject({ title: "The editor stops at the page edge", date: "2026-10-10" });
    expect(list.find(e => e.number === "45")).toMatchObject({
      date: "2026-10-12",
      title: "Avatars: a quick fix on step 1",
    });
    expect(list.find(e => e.number === "128")).toMatchObject({ date: "2026-10-25", by: "the owner" });
    expect(list.find(e => e.number === "82")?.date).toBe("2026-10-12"); // its parentheses close on the next line
    expect(list.find(e => e.number === "43")?.by).toBeUndefined(); // "the after-launch question" is no decider
  });

  test("changes: refines amends, replaces supersedes, a possessive in another clause is nothing", () => {
    const byNumber = (n: string): ListEntry => entry(list, n);
    expect(findChanges(byNumber("82"), "numbered")).toEqual({ superseded: [], amended: ["79"] });
    expect(findChanges(byNumber("129"), "numbered")).toEqual({ superseded: ["10"], amended: [] });
    expect(findChanges(byNumber("44"), "numbered")).toEqual({ superseded: [], amended: [] });
    const text = (t: string): ListEntry => ({ number: "9", date: "2026-01-01", title: "t", text: t });
    expect(findChanges(text("Replaces decisions 3 and 4; the rest of decision 5's plan stays."), "numbered")).toEqual({
      superseded: ["3", "4"],
      amended: [],
    });
    expect(findChanges(text("It replaces the wording in decisions 6, 7."), "numbered").amended).toEqual(["6", "7"]);
  });
});

describe("labelled lists (apps/web/docs/decisions.md)", () => {
  const list = parseDecisionList(fixture("labelled.md"), "labelled");

  test("entries keep their labels; titles from the first sentence without the user's remarks", () => {
    expect(list).toHaveLength(24);
    expect(list[0]).toMatchObject({ number: "L1", date: "2026-10-16", title: "A notes app for the owner's team" });
    expect(list.find(e => e.number === "L33")).toMatchObject({
      by: "the owner",
      title: "Useful for teams from 1 to 100 people, not only 8",
    });
    expect(list.find(e => e.number === "L112")?.title).toBe(
      "A PoC of the board as a kanban view (design/kanban-poc.md)"
    );
    const l87 = list.find(e => e.number === "L87");
    expect(l87?.title).toBe("The one profile's progress, five answers");
    expect(l87?.text).toContain("\n2. Power users: both a gentle automatic scaling");
  });

  test("changes: Refines L1, L31; replaces L96's; L112's ... is replaced; not l54-toolbar", () => {
    const of = (n: string): ReturnType<typeof findChanges> => findChanges(entry(list, n), "labelled");
    expect(of("L33")).toEqual({ superseded: [], amended: ["L1", "L31"] });
    expect(of("L97")).toEqual({ superseded: [], amended: ["L96"] });
    expect(of("L124")).toEqual({ superseded: [], amended: ["L112"] });
    expect(of("L66")).toEqual({ superseded: [], amended: [] });
    expect(of("L125")).toEqual({ superseded: ["L2"], amended: [] });
  });

  test("ids: unique slugs, the label added when two share one (or an existing id has it)", () => {
    const entries = [
      { number: "L1", date: "2026-01-01", title: "Same title", text: "a" },
      { number: "L2", date: "2026-01-02", title: "Same title", text: "b" },
      { number: "L3", date: "2026-01-03", title: "Taken", text: "c" },
    ];
    expect(toDecisions(entries, "labelled", {}, ["taken"]).map(d => d.id)).toEqual([
      "same-title-l1",
      "same-title-l2",
      "taken-l3",
    ]);
  });
});

describe("import", () => {
  test("round trip: both lists, the index, a clean check, a rerun that changes nothing", () => {
    const root = monorepo();
    const first = importDecisions(root, "docs/decisions.md", "numbered");
    expect(first).toContain("wrote docs/decisions/2026-10-10-notes-sync-only-over-the-account.md");
    expect(first).toContain(
      "wrote docs/decisions/2026-10-10-every-page-must-load-fast.md (superseded by decisions-as-files-managed-by-plan)"
    );
    expect(first[first.length - 1]).toBe("wrote docs/decisions.md");
    const second = importDecisions(root, "apps/web/docs/decisions.md", "labelled", { scope: ["web"] });
    expect(second).toContain(
      "wrote docs/decisions/2026-10-17-a-standalone-web-app.md (superseded by a-synthetic-entry-for-the-tests)"
    );
    expect(readDecisions(root, { dir: "docs/decisions", index: "docs/decisions.md" }).decisions).toHaveLength(52);
    expect(checkDecisions(root)).toEqual([]);

    const index = fs.readFileSync(path.join(root, "docs/decisions.md"), "utf8");
    expect(index).toContain(
      "- backlog-on-github-issues-plan-me · 128 · 2026-10-25 · current · - · Backlog on GitHub issues (plan-me), docs to the Wiki (docs-me)\n"
    );
    expect(index).toContain(
      "- longer-trials-b · 79 · 2026-10-11 · amended by trial-and-grace-lengths-in-data · - · Longer trials (B)\n"
    );
    expect(index).toContain(
      "- a-poc-of-the-board · L112 · 2026-10-28 · amended by columns-are-twice-as-wide · web · "
    );
    expect(index.indexOf("## Superseded")).toBeLessThan(index.indexOf("- a-standalone-web-app · L2 "));

    const rerun = importDecisions(root, "apps/web/docs/decisions.md", "labelled", { scope: ["web"] });
    expect(rerun[0]).toBe("exists L1 docs/decisions/2026-10-16-a-notes-app-for-the-owners.md");
    expect(rerun.every(l => l.startsWith("exists "))).toBe(true);
    expect(checkDecisions(root)).toEqual([]);
  });

  test("a rerun keeps the ids of existing files, even when today's slug differs (#25)", () => {
    const list = [
      "1. **What has no future in the new release is removed** (2026-10-01, the owner): text one",
      "2. **The report is built from the nightly data** (2026-10-02, the owner): text two",
      "",
    ].join("\n");
    // A file written by an earlier version, whose slug still ended on stop words.
    const old = formatDecision({
      id: "what-has-no-future-in-the",
      number: "1",
      date: "2026-10-01",
      by: "the owner",
      status: "current",
      scope: [],
      summary: "What has no future in the new release is removed",
      title: "What has no future in the new release is removed",
      text: "text one",
    });
    const root = repo({ "list.md": list, "docs/decisions/2026-10-01-what-has-no-future-in-the.md": old });
    expect(importDecisions(root, "list.md", "numbered")).toEqual([
      "exists 1 docs/decisions/2026-10-01-what-has-no-future-in-the.md",
      "wrote docs/decisions/2026-10-02-report-is-built.md",
      "wrote docs/decisions.md",
    ]);
    const ids = readDecisions(root, { dir: "docs/decisions", index: "docs/decisions.md" }).decisions.map(d => d.id);
    expect(ids.sort()).toEqual(["report-is-built", "what-has-no-future-in-the"]);
    expect(importDecisions(root, "list.md", "numbered").every(l => l.startsWith("exists "))).toBe(true);
    expect(checkDecisions(root)).toEqual([]);
  });

  test("--dry-run writes nothing; --by fills in entries that don't say", () => {
    const root = monorepo();
    const lines = importDecisions(root, "docs/decisions.md", "numbered", { dryRun: true, by: "the owner" });
    expect(lines[0]).toBe("would write docs/decisions/2026-10-10-notes-sync-only-over-the-account.md");
    expect(fs.existsSync(path.join(root, "docs/decisions"))).toBe(false);
    importDecisions(root, "docs/decisions.md", "numbered", { by: "the owner" });
    const text = fs.readFileSync(
      path.join(root, "docs/decisions/2026-10-10-notes-sync-only-over-the-account.md"),
      "utf8"
    );
    expect(text).toContain('by: "the owner"');
    expect(() => importDecisions(root, "docs/decisions.md", "csv" as never)).toThrow(/unknown format "csv"/);
  });

  test("an entry without a date is an error", () => {
    const root = repo({ "list.md": "1. **No date anywhere:** text\n" });
    expect(() => importDecisions(root, "list.md", "numbered")).toThrow(/decision 1: no date/);
  });

  test("the decisions_import command", async () => {
    const root = monorepo();
    const ctx = { backlog: () => { throw new Error("no backlog"); }, root }; // prettier-ignore
    const out = await COMMANDS.decisions_import.run(ctx, {
      file: "apps/web/docs/decisions.md",
      format: "labelled",
    });
    expect(out.text.split("\n")).toHaveLength(25);
    expect((await COMMANDS.decisions_check.run(ctx, {})).failed).toBe(false);
  });
});

describe("the CLI (the bundled lib/cli)", () => {
  const cli = path.join(__dirname, "..", "bin", "plan-me");
  const run = (root: string, args: string[]): string =>
    execFileSync("node", [cli, ...args], { cwd: root, encoding: "utf8", env: { ...process.env, GITHUB_TOKEN: "x" } });

  test("import, decide, index and check need no configuration", () => {
    const root = monorepo();
    expect(run(root, ["decisions", "import", "docs/decisions.md", "--format", "numbered"])).toContain(
      "wrote docs/decisions.md"
    );
    const decided = run(root, [
      "decide", "One file per decision.", "--title", "Decisions as files", "--by", "the owner",
      "--date", "2026-11-01", "--scope", "docs", "--supersedes", "backlog-on-github-issues-plan-me",
    ]); // prettier-ignore
    expect(decided).toBe(
      [
        "wrote docs/decisions/2026-11-01-decisions-as-files.md",
        "backlog-on-github-issues-plan-me superseded by decisions-as-files",
        "wrote docs/decisions.md",
        "- decisions-as-files · - · 2026-11-01 · current · docs · Decisions as files",
        "",
      ].join("\n")
    );
    expect(run(root, ["decisions", "check"])).toBe("docs/decisions: ok\n");
    expect(run(root, ["decisions", "index"])).toBe("docs/decisions.md up to date\n");
    fs.appendFileSync(path.join(root, "docs/decisions.md"), "- hand edit\n");
    let failure: { status?: number; stdout?: string } = {};
    try {
      run(root, ["decisions", "check"]);
    } catch (e) {
      failure = e as typeof failure;
    }
    expect(failure.status).toBe(1);
    expect(failure.stdout).toMatch(/^docs\/decisions\.md: stale or edited by hand/);
    expect(JSON.parse(run(root, ["--json", "decisions", "index"]))).toEqual({
      index: "docs/decisions.md",
      changed: true,
    });
  });
});
