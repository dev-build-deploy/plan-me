/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { Config } from "./config";
import { Section, sectionsFor } from "./templates";
import { runVale, ValeError, ValeRunner } from "./vale";

/** How serious a finding is: errors refuse the issue, warnings only report (the plugin denies them once). */
export type Level = "error" | "warning";

/** One finding about an issue: from plan-me's structure rules (PI00x) or from Vale. */
export interface IssueDiagnostic {
  rule: string;
  level: Level;
  /** 1-based line and column in the body (1:1 for the title and the type). */
  line: number;
  column: number;
  message: string;
  hint?: string;
  source: "plan-me" | "vale";
}

/** plan-me's structure rules for an issue. The prose rules are Vale's (src/vale.ts), always warnings. */
export const ISSUE_RULES: { id: string; level: Level; summary: string }[] = [
  { id: "PI001", level: "error", summary: "The issue has no type." },
  { id: "PI002", level: "error", summary: "The type is not one of the configured types." },
  { id: "PI003", level: "error", summary: "The issue has no title." },
  { id: "PI004", level: "error", summary: "The body has no sections (`### Why`, ...)." },
  { id: "PI005", level: "error", summary: "A required section of the type is missing." },
  { id: "PI006", level: "error", summary: "A required section is empty or holds only placeholders." },
  { id: "PI007", level: "warning", summary: "The sections are out of the type's order." },
];

/** What is checked: the title, the type and the body (markdown, with `### <section>` headings). */
export interface IssueInput {
  title?: string;
  type?: string;
  body: string;
}

/** The result of a check: the findings, and why the prose was not checked (Vale off or not available). */
export interface IssueReport {
  diagnostics: IssueDiagnostic[];
  errors: number;
  warnings: number;
  /** Set when the Vale rules did not run. */
  skipped?: string;
}

/** How the check runs. */
export interface IssueCheckOptions {
  /** The repository root, where the glossary file is read. */
  root: string;
  /** false: only the structure rules; a function: a stand-in for Vale (tests). Default: the real Vale. */
  vale?: boolean | ValeRunner;
  /** Item ids a bare mention of must be explained (an import passes its records' ids). */
  itemIds?: string[];
}

/** A section of a body: its heading, the heading's line and its content lines. */
export interface BodySection {
  label: string;
  line: number;
  content: string[];
}

const HEADING = /^#{2,3}[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const FENCE = /^\s*(```|~~~)/;
/** Lines that hold no content: GitHub's empty form answer and template leftovers. */
const PLACEHOLDER = /^(?:_no response_|todo|tbd|tba|n\/a|na|none|-|\.\.\.|…)\.?$/i;
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;

/** The normal form of a heading for matching: lowercase, no trailing colon, single spaces. */
function norm(label: string): string {
  return label.trim().replace(/:$/, "").replace(/\s+/g, " ").toLowerCase();
}

/** The `##`/`###` sections of a body (headings in fenced code blocks don't count), in order. */
export function parseSections(body: string): BodySection[] {
  const sections: BodySection[] = [];
  let fenced = false;
  body
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .forEach((text, i) => {
      if (FENCE.test(text)) fenced = !fenced;
      const m = fenced ? null : HEADING.exec(text);
      if (m) sections.push({ label: m[1], line: i + 1, content: [] });
      else if (sections.length > 0) sections[sections.length - 1].content.push(text);
    });
  return sections;
}

/** Whether a section's lines hold real content (not only comments, placeholders or empty list items). */
export function hasContent(lines: string[]): boolean {
  return lines
    .join("\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .map(l => l.replace(LIST_MARKER, "").trim())
    .some(l => l !== "" && !PLACEHOLDER.test(l));
}

/** The configured type for a name (case-insensitive), or undefined. */
export function configuredType(config: Config, type: string | undefined): string | undefined {
  if (!type) return undefined;
  return config.types.find(t => t.toLowerCase() === type.trim().toLowerCase());
}

/** The body skeleton of a type: one `### <section>` per section, with its description as a hint comment. */
export function skeletonFor(type: string): string {
  return sectionsFor(type)
    .map(s => `### ${s.label}\n\n${s.description ? `<!-- ${s.description} -->` : ""}`.trimEnd())
    .join("\n\n");
}

function sectionList(sections: Section[]): string {
  return sections.map(s => `${s.label}${s.required ? "" : " (optional)"}`).join(", ");
}

/** plan-me's structure rules: type, title, sections. Deterministic: the same input gives the same output. */
export function checkIssueStructure(input: IssueInput, config: Config): IssueDiagnostic[] {
  const out: IssueDiagnostic[] = [];
  const add = (rule: string, line: number, message: string, hint?: string): void => {
    const level = ISSUE_RULES.find(r => r.id === rule)?.level ?? "error";
    out.push({ rule, level, line, column: 1, message, hint, source: "plan-me" });
  };
  if (input.title !== undefined && input.title.trim() === "") {
    add("PI003", 1, "The issue has no title.", "Give it a title that says what the issue is about.");
  }
  const type = configuredType(config, input.type);
  if (!input.type?.trim()) {
    add(
      "PI001",
      1,
      "The issue has no type.",
      `Give it one of: ${config.types.join(", ")} (\`--type\`, or the type: field of an imported item).`
    );
  } else if (!type) {
    add("PI002", 1, `"${input.type}" is not a configured type.`, `Use one of: ${config.types.join(", ")}.`);
  }
  const sections = parseSections(input.body);
  if (sections.length === 0) {
    const shape = type ? ` A ${type} has: ${sectionList(sectionsFor(type))}.` : "";
    add(
      "PI004",
      1,
      "The body has no sections: it is free text.",
      `Write the body as \`### <section>\` headings, each with its text.${shape}`
    );
    return out;
  }
  if (!type) return out;
  const spec = sectionsFor(type);
  const found = new Map<string, BodySection>();
  for (const s of sections) if (!found.has(norm(s.label))) found.set(norm(s.label), s);
  for (const s of spec.filter(x => x.required)) {
    const section = found.get(norm(s.label));
    const purpose = s.description ? ` ${s.description}` : "";
    if (!section) {
      add(
        "PI005",
        1,
        `The "${s.label}" section is missing.`,
        `Add a "### ${s.label}" heading with its text.${purpose}`
      );
    } else if (!hasContent(section.content)) {
      add(
        "PI006",
        section.line,
        `The "${s.label}" section is empty or holds only placeholders.`,
        `Write it.${purpose}`
      );
    }
  }
  const positions = spec.map(s => found.get(norm(s.label))?.line).filter((l): l is number => l !== undefined);
  const early = positions.findIndex((l, i) => i > 0 && l < positions[i - 1]);
  if (early > 0) {
    const label = spec.filter(s => found.has(norm(s.label)))[early].label;
    add(
      "PI007",
      positions[early],
      `The sections are out of order: "${label}" comes too early.`,
      `Use this order: ${spec.map(s => s.label).join(", ")}.`
    );
  }
  return out;
}

function sortDiagnostics(d: IssueDiagnostic[]): IssueDiagnostic[] {
  return [...d].sort((a, b) => a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule));
}

function report(diagnostics: IssueDiagnostic[], skipped?: string): IssueReport {
  const sorted = sortDiagnostics(diagnostics);
  const errors = sorted.filter(d => d.level === "error").length;
  return { diagnostics: sorted, errors, warnings: sorted.length - errors, skipped };
}

/**
 * Checks several issues: the structure rules, then Vale's prose rules over all bodies in one run (as warnings).
 * When Vale is off (`issueCheck.vale: false`, `vale: false`) or cannot run, the reports say so in `skipped`.
 */
export async function checkIssues(
  inputs: IssueInput[],
  config: Config,
  options: IssueCheckOptions
): Promise<IssueReport[]> {
  const structure = inputs.map(i => checkIssueStructure(i, config));
  let prose: IssueDiagnostic[][] = inputs.map(() => []);
  let skipped: string | undefined;
  if (options.vale === false || !config.issueCheck.vale) {
    skipped = "the prose rules are off";
  } else if (inputs.length > 0) {
    const runner = typeof options.vale === "function" ? options.vale : runVale;
    try {
      const found = await runner(
        inputs.map(i => i.body),
        config.issueCheck,
        options.root,
        options.itemIds
      );
      prose = found.map(list => list.map(f => ({ ...f, level: "warning" as const, source: "vale" as const })));
    } catch (e) {
      if (!(e instanceof ValeError)) throw e;
      skipped = `the prose was not checked: ${e.message}`;
    }
  }
  return inputs.map((_, i) => report([...structure[i], ...(prose[i] ?? [])], skipped));
}

/** Checks one issue (see checkIssues). */
export async function checkIssue(input: IssueInput, config: Config, options: IssueCheckOptions): Promise<IssueReport> {
  return (await checkIssues([input], config, options))[0];
}

/** One line per finding: `line 3: error: [PI006] ... Fix: ...`. */
export function problemLines(r: IssueReport): string[] {
  return r.diagnostics.map(
    d => `line ${d.line}: ${d.level}: [${d.rule}] ${d.message}${d.hint ? ` Fix: ${d.hint}` : ""}`
  );
}

/** The one-line summary of a report. */
export function summaryLine(r: IssueReport): string {
  if (r.errors === 0 && r.warnings === 0) return "The issue passes every check.";
  const s = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;
  return `Found ${s(r.errors, "error")} and ${s(r.warnings, "warning")} in the issue.`;
}

/** The text report: the findings, the summary, and the skipped note. */
export function formatIssueText(r: IssueReport): string {
  return [...problemLines(r), summaryLine(r), ...(r.skipped ? [`note: ${r.skipped}`] : [])].join("\n");
}

/** The report for the Claude Code plugin: the counts and a compact text (pull-me's `--format hook` shape). */
export function formatIssueHook(r: IssueReport): string {
  return JSON.stringify({
    errors: r.errors,
    warnings: r.warnings,
    text: problemLines(r).join("\n"),
    skipped: r.skipped,
  });
}

/** The error raised when an issue is refused: the findings and how a passing body looks. */
export class IssueRefused extends Error {
  constructor(
    readonly report: IssueReport,
    type: string | undefined
  ) {
    const shape = type?.trim() ? `\n\nA ${type} issue has these sections:\n${skeletonFor(type)}` : "";
    super(
      `the issue was not created: ${report.errors} error(s) in its text.\n${problemLines(report)
        .filter(l => l.includes(" error: "))
        .join("\n")}${shape}`
    );
  }
}
