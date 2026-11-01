/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

import {
  checkDecisions,
  Decision,
  DEFAULT_DECISIONS,
  formatIndex,
  readDecisions,
  recordDecision,
} from "../src/decisions";
import { installMergeDriver, mergeDecisions, parseIndex, runMergeDriver } from "../src/decisions-merge";

import { repo } from "./repo";

const CLI = path.join(__dirname, "..", "bin", "plan-me");
const base = { by: "the owner", date: "2026-11-01" };

/** Runs git in a repository; returns stdout. Throws (with the output) when git fails. */
function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** A git repository with one committed decision and its index, on `main`. */
function gitRepo(): string {
  const root = repo();
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "commit.gpgsign", "false");
  recordDecision(root, { ...base, title: "Start", text: "The first decision." });
  git(root, "add", "-A");
  git(root, "commit", "-qm", "start");
  return root;
}

/** Two branches off main, each recording a decision (the second one also supersedes `start`). */
function twoBranches(root: string): void {
  git(root, "checkout", "-qb", "one");
  recordDecision(root, { ...base, title: "Branch one", text: "One." });
  git(root, "add", "-A");
  git(root, "commit", "-qm", "one");
  git(root, "checkout", "-q", "main");
  git(root, "checkout", "-qb", "two");
  recordDecision(root, { ...base, title: "Branch two", text: "Two.", supersedes: "start" });
  git(root, "add", "-A");
  git(root, "commit", "-qm", "two");
}

describe("the merge driver", () => {
  test("parseIndex reads back what formatIndex writes", () => {
    const root = repo();
    recordDecision(root, { ...base, title: "Old", text: "x", scope: ["a", "b"] });
    recordDecision(root, { ...base, title: "New · with a dot", text: "y", supersedes: "old" });
    const { decisions } = readDecisions(root, DEFAULT_DECISIONS);
    const index = fs.readFileSync(path.join(root, "docs/decisions.md"), "utf8");
    expect(formatIndex(parseIndex(index), DEFAULT_DECISIONS)).toBe(index);
    expect(new Set(parseIndex(index).map(d => d.id))).toEqual(new Set(decisions.map(d => d.id)));
    expect(() => parseIndex("- a hand-written line\n")).toThrow(/not an index line/);
  });

  test("three-way: a side's change wins over the unchanged side; both changed: the further status", () => {
    const d = (id: string, status: "current" | "amended" | "superseded" = "current"): Decision => ({
      id, date: "2026-11-01", by: "", status, scope: [], summary: id, title: "", text: "",
      supersededBy: status === "current" ? undefined : "x",
    }); // prettier-ignore
    const merged = mergeDecisions(
      [d("kept"), d("removed-by-us"), d("changed-by-them"), d("both")],
      [d("kept"), d("changed-by-them"), d("both", "amended"), d("ours-new")],
      [d("kept"), d("removed-by-us"), d("changed-by-them", "amended"), d("both", "superseded"), d("theirs-new")]
    );
    expect(merged.map(m => `${m.id}:${m.status}`).sort()).toEqual([
      "both:superseded",
      "changed-by-them:amended",
      "kept:current",
      "ours-new:current",
      "theirs-new:current",
    ]);
  });

  test("without the driver, two branches adding decisions conflict in the index", () => {
    const root = gitRepo();
    twoBranches(root);
    git(root, "checkout", "-q", "one");
    expect(() => git(root, "merge", "-q", "--no-edit", "two")).toThrow();
    expect(git(root, "diff", "--name-only", "--diff-filter=U")).toBe("docs/decisions.md\n");
  });

  test("with `decisions install`, the same merge is clean and the index matches the files", () => {
    const root = gitRepo();
    const command = `node "${CLI}"`;
    expect(installMergeDriver(root, command)).toEqual([
      ".gitattributes: docs/decisions.md merge=plan-me-decisions",
      'git config merge.plan-me-decisions.name "plan-me: regenerate the decisions index"',
      `git config merge.plan-me-decisions.driver "${command} decisions merge-driver %O %A %B"`,
    ]);
    expect(installMergeDriver(root, command)).toEqual([]);
    git(root, "add", ".gitattributes");
    git(root, "commit", "-qm", "merge driver");
    twoBranches(root);
    git(root, "checkout", "-q", "one");
    git(root, "merge", "-q", "--no-edit", "two");
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(checkDecisions(root)).toEqual([]);
    const index = fs.readFileSync(path.join(root, "docs/decisions.md"), "utf8");
    expect(index).toContain("- branch-one · - · 2026-11-01 · current · - · Branch one\n");
    expect(index).toContain("- branch-two · - · 2026-11-01 · current · - · Branch two\n");
    expect(index).toContain("- start · - · 2026-11-01 · superseded by branch-two · - · Start\n");
  });

  test("a side that isn't an index stops the merge as a conflict", () => {
    const root = repo({ o: "", a: "- a hand-written line\n", b: "" });
    expect(runMergeDriver(path.join(root, "o"), path.join(root, "a"), path.join(root, "b"), root)).toBe(false);
    expect(fs.readFileSync(path.join(root, "a"), "utf8")).toBe("- a hand-written line\n");
  });
});
