/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import fs from "fs";
import os from "os";
import path from "path";

import { RawIssue } from "../src/api";
import { CHECK_COMMENT_MARKER, checkComment, onIssueText } from "../src/automation";
import { Backlog } from "../src/backlog";
import { CommandContext, COMMANDS } from "../src/commands";
import { resolveConfig } from "../src/config";
import {
  checkIssue,
  checkIssueStructure,
  formatIssueHook,
  formatIssueText,
  IssueRefused,
  parseSections,
  skeletonFor,
} from "../src/issue-check";
import { sectionsFor } from "../src/templates";
import {
  DEFAULT_REFERENCE_PATTERNS,
  mapAlerts,
  parseGlossary,
  resolveVale,
  runVale,
  ValeError,
  ValeFinding,
  writeValeConfig,
} from "../src/vale";

import { CONFIG, setup } from "./fake";

/** A body with every section of a type filled with a sentence. */
function filled(type: string, skip: string[] = []): string {
  return sectionsFor(type)
    .filter(s => !skip.includes(s.label))
    .map(s => `### ${s.label}\n\nThe ${s.label.toLowerCase()} of the export, in plain words.`)
    .join("\n\n");
}

const NO_VALE = { root: os.tmpdir(), vale: false as const };
const rules = (body: string, type?: string, title?: string): string[] =>
  checkIssueStructure({ body, type, title }, CONFIG).map(d => `${d.level} ${d.rule} ${d.line}`);

describe("the sections per type", () => {
  test("every type starts with its opening sections, in order; which are required", () => {
    const required = (type: string): string[] =>
      sectionsFor(type)
        .filter(s => s.required)
        .map(s => s.label);
    expect(required("Task")).toEqual(["Why", "Context", "What", "Done when"]);
    expect(required("Feature")).toEqual(["Context", "Problem", "Expected value", "Acceptance criteria"]);
    expect(required("Bug")).toEqual([
      "Context",
      "Steps to reproduce",
      "Observed behavior",
      "Expected behavior",
      "Additional context",
    ]);
    expect(required("Design")).toEqual(["Why", "Context", "What"]);
    expect(required("Decision")).toEqual(["Why", "Context", "What", "Options", "Who decides"]);
    expect(required("Epic")).toEqual(["Why", "Context", "What", "Outcome"]);
    expect(required("Spike")).toEqual(["Why", "Context", "What"]);
  });

  test("a filled body of each type passes the structure rules", () => {
    for (const type of CONFIG.types) expect(rules(filled(type), type, "A title")).toEqual([]);
  });
});

describe("the structure rules", () => {
  test("no type, an unknown type, no title", () => {
    expect(rules(filled("Task"))).toEqual(["error PI001 1"]);
    expect(rules(filled("Task"), "Chore")).toEqual(["error PI002 1"]);
    expect(rules(filled("Task"), "task", " ")).toEqual(["error PI003 1"]);
  });

  test("free text: no sections", () => {
    expect(rules("Some working notes: after the export, see L99.", "Task")).toEqual(["error PI004 1"]);
    const d = checkIssueStructure({ body: "notes", type: "Bug" }, CONFIG)[0];
    expect(d.hint).toContain("A Bug has: Context, Steps to reproduce, Observed behavior");
  });

  test("a missing or empty required section; optional ones may be left out", () => {
    expect(rules(filled("Task", ["Why"]), "Task")).toEqual(["error PI005 1"]);
    const empty = filled("Task").replace("The context of the export, in plain words.", "_No response_\n\n- [ ] ...");
    expect(rules(empty, "Task")).toEqual(["error PI006 5"]);
    const comment = filled("Task").replace("The what of the export, in plain words.", "<!-- say what -->\nTODO");
    expect(rules(comment, "Task")).toEqual(["error PI006 9"]);
    expect(rules(filled("Feature", ["Design docs"]), "Feature")).toEqual([]);
  });

  test("headings: ## or ###, any case, a trailing colon; not inside fenced code", () => {
    const body = "## why:\n\nValue.\n\n### CONTEXT\n\nToday.\n\n```\n### What\n```\n\n### Done when\n\nDone.";
    expect(rules(body, "Task")).toEqual(["error PI005 1"]);
    expect(parseSections(body).map(s => s.label)).toEqual(["why:", "CONTEXT", "Done when"]);
  });

  test("sections out of order are a warning", () => {
    const body = "### Context\n\nToday.\n\n### Why\n\nValue.\n\n### What\n\nThis.\n\n### Done when\n\nDone.";
    expect(rules(body, "Task")).toEqual(["warning PI007 1"]);
  });

  test("the skeleton lists the type's sections, with hints, and fails until filled", () => {
    expect(skeletonFor("Decision")).toMatch(/^### Why\n\n<!-- The value: .* -->\n\n### Context/);
    expect(skeletonFor("Decision")).toContain("### Who decides");
    expect(rules(skeletonFor("Task"), "Task")).toEqual([
      "error PI006 1",
      "error PI006 5",
      "error PI006 9",
      "error PI006 13",
    ]);
  });
});

describe("the reports", () => {
  test("text, hook and the refusal", async () => {
    const r = await checkIssue({ body: "notes", type: "Task", title: "x" }, CONFIG, NO_VALE);
    expect(r).toMatchObject({ errors: 1, warnings: 0, skipped: "the prose rules are off" });
    expect(formatIssueText(r)).toMatch(
      /^line 1: error: \[PI004\] The body has no sections: it is free text\. Fix: .*\nFound 1 error and 0 warnings in the issue\.\nnote: the prose rules are off$/
    );
    expect(JSON.parse(formatIssueHook(r))).toMatchObject({
      errors: 1,
      warnings: 0,
      text: expect.stringMatching(/^line 1/),
    });
    const refused = new IssueRefused(r, "Task");
    expect(refused.message).toMatch(/^the issue was not created: 1 error\(s\) in its text\.\nline 1: error: \[PI004\]/);
    expect(refused.message).toContain("A Task issue has these sections:\n### Why");
  });

  test("Vale's findings are warnings; Vale that cannot run is a note, not a failure", async () => {
    const vale = async (bodies: string[]): Promise<ValeFinding[][]> =>
      bodies.map(() => [{ rule: "DevBuildDeploy.BareReferences", line: 3, column: 1, message: "'See L99' is bare" }]);
    const r = await checkIssue({ body: filled("Task"), type: "Task" }, CONFIG, { root: os.tmpdir(), vale });
    expect(r).toMatchObject({ errors: 0, warnings: 1 });
    expect(r.diagnostics[0]).toMatchObject({ level: "warning", source: "vale" });
    const broken = async (): Promise<never> => {
      throw new ValeError("download failed (404)");
    };
    const b = await checkIssue({ body: filled("Task"), type: "Task" }, CONFIG, { root: os.tmpdir(), vale: broken });
    expect(b).toMatchObject({ errors: 0, warnings: 0, skipped: "the prose was not checked: download failed (404)" });
    const off = resolveConfig({ repository: "o/r", issueCheck: { vale: false } });
    expect((await checkIssue({ body: "x", type: "Task" }, off, { root: os.tmpdir(), vale })).skipped).toBe(
      "the prose rules are off"
    );
  });
});

describe("the Vale configuration (pull-me's styles)", () => {
  test("the glossary, the reference patterns and the item ids are filled in", () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "plan-me-vale-test-"));
    const config = { ...CONFIG.issueCheck, referencePatterns: ["\\bRFC-\\d+\\b"] };
    const ini = writeValeConfig(work, config, { "sync engine": "the part that copies notes", SSO: "single sign-on" }, [
      "export-csv",
    ]);
    expect(fs.readFileSync(ini, "utf8")).toContain("BasedOnStyles = DevBuildDeploy, PlanMe");
    const style = (s: string, f: string): string => fs.readFileSync(path.join(work, "styles", s, f), "utf8");
    expect(style("DevBuildDeploy", "Glossary.yml")).toContain("first: '\\b(sync engine|SSO)\\b'");
    expect(style("DevBuildDeploy", "BareReferences.yml")).toContain(DEFAULT_REFERENCE_PATTERNS[0]);
    expect(style("DevBuildDeploy", "BareReferences.yml")).toContain("RFC-");
    expect(style("PlanMe", "ItemReferences.yml")).toContain("\\bexport-csv\\b");
    expect(style("DevBuildDeploy", "Abbreviations.yml")).toMatch(/- 'SSO'\n$/);
  });

  test("glossary files and alerts read as pull-me reads them", () => {
    expect(parseGlossary("# x\n- **Notebook**: a folder of notes\n* **SSO** — single sign-on\ntext")).toEqual({
      Notebook: "a folder of notes",
      SSO: "single sign-on",
    });
    const alert = {
      Check: "DevBuildDeploy.Glossary",
      Line: 2,
      Span: [5, 12] as [number, number],
      Message: "m",
      Match: "notebook",
    };
    expect(mapAlerts([alert], { Notebook: "a folder of notes" })[0]).toMatchObject({
      rule: "DevBuildDeploy.Glossary",
      line: 2,
      column: 5,
      hint: expect.stringContaining('"notebook: a folder of notes"'),
    });
  });

  test("with the real Vale: a glossary term, a bare reference, an item named after 'after', a weasel word", async () => {
    const vale = await resolveVale().catch(() => undefined);
    if (!vale) return; // no Vale and no network: the configuration tests above still run
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "plan-me-root-"));
    fs.mkdirSync(path.join(root, ".github"));
    fs.writeFileSync(path.join(root, ".github/glossary.md"), "- **notebook**: a folder of notes in the app\n");
    const body = [
      "### Why",
      "",
      "Every notebook needs an export.",
      "",
      "### Context",
      "",
      "See L99.",
      "",
      "### What",
      "",
      "Build it after export-csv. It is very small.",
    ].join("\n");
    const [found, clean] = await runVale([body, filled("Task")], CONFIG.issueCheck, root, ["export-csv"]);
    expect(found.map(f => `${f.line} ${f.rule}`)).toEqual([
      "3 DevBuildDeploy.Glossary",
      "7 DevBuildDeploy.BareReferences",
      "11 PlanMe.ItemReferences",
      "11 DevBuildDeploy.Weasel",
    ]);
    expect(clean).toEqual([]);
  }, 120000);
});

describe("new and check_issue", () => {
  const ctx = (backlog: Backlog, vale: unknown = false): CommandContext => ({
    backlog: () => backlog,
    root: os.tmpdir(),
    check: { vale: vale as false },
  });

  test("new refuses a body without the type's sections and creates nothing", async () => {
    const { api, backlog } = setup();
    await expect(COMMANDS.new.run(ctx(backlog), { title: "Export", type: "Task", body: "notes" })).rejects.toThrow(
      IssueRefused
    );
    await expect(COMMANDS.new.run(ctx(backlog), { title: "Export", body: filled("Task") })).rejects.toThrow(/PI001/);
    expect(api.issues.size).toBe(0);
  });

  test("new creates a passing issue; warnings come back as a warning, design docs fill their section", async () => {
    const { api, backlog } = setup();
    const vale = async (bodies: string[]): Promise<ValeFinding[][]> =>
      bodies.map(() => [{ rule: "DevBuildDeploy.Weasel", line: 3, column: 9, message: "'very' weakens it" }]);
    const r = await COMMANDS.new.run(ctx(backlog, vale), {
      title: "Export",
      type: "Feature",
      body: filled("Feature", ["Design docs"]),
      design: ["docs/design/export.md"],
    });
    expect(r.text).toMatch(/^#1 created #1/);
    expect(r.warning).toBe(
      "warning: the issue text has 1 warning(s); fix them with `plan-me check-issue`:\n" +
        "line 3: warning: [DevBuildDeploy.Weasel] 'very' weakens it"
    );
    expect(api.issues.get(1)?.body).toMatch(
      /### Design docs\n\n- \[docs\/design\/export\.md\]\(https:\/\/github\.com\/o\/r\/blob\/HEAD\/docs\/design\/export\.md\)\n$/
    );
  });

  test("check_issue needs no token and no configuration file", async () => {
    const noBacklog = (): never => {
      throw new Error("no token");
    };
    const bad = { backlog: noBacklog, root: os.tmpdir(), config: noBacklog, check: { vale: false as const } };
    const r = await COMMANDS.check_issue.run(bad, { body: filled("Bug"), type: "Bug" });
    expect(r).toMatchObject({ failed: false, text: "The issue passes every check.\nnote: the prose rules are off" });
    const fail = await COMMANDS.check_issue.run(bad, { body: "x" });
    expect(fail.failed).toBe(true);
  });
});

describe("the Action on issues opened and edited", () => {
  test("one comment listing the problems, updated on edits, then resolved; the label follows", async () => {
    const { api, backlog } = setup();
    api.add({ title: "Notes", body: "some working notes", issueType: "Task" });
    const options = { ...NO_VALE, label: "needs-sections" };
    const first = await onIssueText(backlog, 1, options);
    expect(first.report.errors).toBe(1);
    expect(first.lines).toEqual(["#1 issue check comment", "#1 label needs-sections"]);
    const comment = (api.commentIds.get(1) ?? [])[0];
    expect(comment.body).toContain(CHECK_COMMENT_MARKER);
    expect(comment.body).toContain("[PI004]");
    expect(comment.body).toContain("```markdown\n### Why");

    expect((await onIssueText(backlog, 1, options)).lines).toEqual([]); // nothing changed: nothing to do

    (api.issues.get(1) as RawIssue).body = filled("Task", ["Done when"]);
    expect((await onIssueText(backlog, 1, options)).lines).toEqual(["#1 issue check comment updated"]);
    expect(api.commentIds.get(1)).toHaveLength(1);
    expect(api.commentIds.get(1)?.[0].body).toContain("[PI005]");

    (api.issues.get(1) as RawIssue).body = filled("Task");
    const passed = await onIssueText(backlog, 1, options);
    expect(passed.lines).toEqual(["#1 issue check comment resolved", "#1 label needs-sections removed"]);
    expect(api.commentIds.get(1)?.[0].body).toBe(checkComment(undefined, "Task"));
    expect(api.issues.get(1)?.labels).toEqual([]);
  });

  test("an issue that passes from the start gets no comment", async () => {
    const { api, backlog } = setup();
    api.add({ title: "Export", body: filled("Bug"), issueType: "Bug" });
    expect((await onIssueText(backlog, 1, NO_VALE)).lines).toEqual([]);
    expect(api.commentIds.get(1)).toBeUndefined();
  });
});
