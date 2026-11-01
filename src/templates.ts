/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { createHash } from "crypto";
import fs from "fs";
import path from "path";

import { Config, typeLabel } from "./config";
import { slugify, today } from "./decisions";
import { yamlLicenseHeader } from "./license";

/** The folder GitHub reads issue forms from, relative to the repository root. */
export const TEMPLATE_DIR = ".github/ISSUE_TEMPLATE";
/** The chooser's configuration file in TEMPLATE_DIR. */
export const CHOOSER_FILE = "config.yml";
/** The heading of the component dropdown (the board fields use their configured names: Priority, Role, Size). */
export const COMPONENT_HEADING = "Component";

/** One text section of an issue form: its heading in the issue body (`### <label>`) and the form's hints. */
export interface Section {
  label: string;
  /** `input` is one line; `textarea` (the default) many. */
  kind?: "input" | "textarea";
  description?: string;
  placeholder?: string;
  required?: boolean;
}

/** The built-in sections of a type: what its issues are about, and the intro shown at the top of its form. */
interface TypeSpec {
  description: string;
  intro?: string;
  sections: Section[];
}

const DESIGN_DOCS: Section = {
  label: "Design docs",
  description: "Paths in the repository or links, one per line.",
  placeholder: "docs/design/sync.md",
};

/**
 * The sections per type (keys lowercase), in form order. They are the headings an issue body has (`### Goal`), so
 * `new` and `import` can write the same ones; other types get TYPE_SPECS.other.
 */
export const TYPE_SPECS: Record<string, TypeSpec> = {
  feature: {
    description: "A new capability, or a change to one",
    sections: [
      { label: "Goal", description: "What should be possible, and for whom?", required: true },
      { label: "Acceptance criteria", description: "When is it done?", placeholder: "- [ ] ..." },
      DESIGN_DOCS,
    ],
  },
  bug: {
    description: "Something does not work as it should",
    sections: [
      { label: "Steps to reproduce", placeholder: "1. ...\n2. ...\n3. ...", required: true },
      { label: "Expected", description: "What should happen?" },
      { label: "Actual", description: "What happens instead?", required: true },
      { label: "Version", kind: "input", description: "The version, build or commit it happens on." },
      { label: "Evidence", description: "Logs, screenshots, a failing test: paste or drag them here." },
    ],
  },
  task: {
    description: "A piece of work that is neither a feature nor a bug",
    sections: [
      { label: "What to do", required: true },
      { label: "Done when", placeholder: "- [ ] ..." },
    ],
  },
  design: {
    description: "Work out how something should look or behave before it is built",
    sections: [
      { label: "Problem", description: "What needs designing, and why now?", required: true },
      { label: "Constraints", description: "What the design must respect." },
      { label: "Options", description: "The directions considered so far." },
      DESIGN_DOCS,
    ],
  },
  decision: {
    description: "A question someone has to decide",
    intro:
      "A decision issue opens as needs-decision. Record the answer with " +
      '`plan-me decide "<text>" --title "<title>" --by "<who>" --question <this issue>`: the pull request that adds ' +
      "the decision file closes this issue.",
    sections: [
      { label: "Question", description: "The question, in one or two sentences.", required: true },
      { label: "Options", description: "The options, with their pros and cons.", placeholder: "1. ...\n2. ..." },
      { label: "Who decides", kind: "input", description: "The person or role who decides." },
      { label: "Context", description: "Why it comes up now; related issues and decisions." },
    ],
  },
  epic: {
    description: "A larger outcome, split into child items",
    sections: [
      { label: "Outcome", description: "What is true when the epic is done?", required: true },
      {
        label: "Child items",
        description: "One per line; or add sub-issues once the epic exists.",
        placeholder: "- [ ] #12",
      },
      DESIGN_DOCS,
    ],
  },
  other: {
    description: "",
    sections: [{ label: "Description", required: true }],
  },
};

/** The text sections of a type's form (the built-in ones, else a single Description). */
export function sectionsFor(type: string): Section[] {
  return (TYPE_SPECS[type.toLowerCase()] ?? TYPE_SPECS.other).sections;
}

/** What decides the files' content besides the configuration. */
export interface TemplateOptions {
  /**
   * The organization's issue types (from the API). A form for one of them sets it (`type:`); others add the type
   * label. Undefined (no token): each existing file keeps the kind it has, new files use the label.
   */
  issueTypes?: string[];
  /** The copyright year for a new file's licence header (default this year; an existing file keeps its year). */
  year?: string;
}

/** A file plan-me writes: its path (relative to the root), the type it is for (none: the chooser) and content. */
export interface TemplateFile {
  path: string;
  type?: string;
  content: string;
}

// --- a small deterministic YAML writer (only what the forms need) ---

type Yaml = string | number | boolean | Yaml[] | { [key: string]: Yaml | undefined };

const PLAIN = /^[A-Za-z][\w .,;:()/'?-]*$/;
const RESERVED = /^(?:y|n|yes|no|on|off|true|false|null|~)$/i;

function scalar(v: string | number | boolean): string {
  if (typeof v !== "string") return String(v);
  return PLAIN.test(v) && !RESERVED.test(v) && !/[ :]$/.test(v) && !/: | #/.test(v) ? v : JSON.stringify(v);
}

function yaml(v: Yaml, indent: string): string[] {
  if (Array.isArray(v)) {
    return v.flatMap(item => {
      const lines = yaml(item, `${indent}  `);
      if (typeof item !== "object") return [`${indent}- ${lines[0].trimStart()}`];
      return [`${indent}- ${lines[0].trimStart()}`, ...lines.slice(1)];
    });
  }
  if (typeof v === "object") {
    const out: string[] = [];
    for (const [key, value] of Object.entries(v)) {
      if (value === undefined) continue;
      if (typeof value === "string" && value.includes("\n")) {
        out.push(`${indent}${key}: |-`, ...value.split("\n").map(l => (l ? `${indent}  ${l}` : "")));
      } else if (Array.isArray(value) && value.length === 0) {
        out.push(`${indent}${key}: []`);
      } else if (typeof value === "object") {
        out.push(`${indent}${key}:`, ...yaml(value, Array.isArray(value) ? indent : `${indent}  `));
      } else {
        out.push(`${indent}${key}: ${scalar(value)}`);
      }
    }
    return out;
  }
  return [`${indent}${scalar(v)}`];
}

// --- the forms ---

const HASH_LINE = /^# plan-me:sha256=([0-9a-f]+)[ \t]*\r?\n/m;
const YEAR = /FileCopyrightText:\s*(\d{4})/;
const NATIVE = /^type:/m;

/** The hash of a file's text without its hash line: it tells a generated file from one edited by hand. */
function hashOf(text: string): string {
  const lf = text.replace(/\r\n/g, "\n").replace(HASH_LINE, "");
  return createHash("sha256").update(lf).digest("hex").slice(0, 16);
}

const GENERATED = [
  "# Generated by plan-me from its configuration (types, boards, fields): run `plan-me templates` after changing it.",
  "# plan-me leaves this file alone once it is edited by hand; `plan-me templates --force` overwrites it.",
];

/** The licence header (when `.reuse-me.json` gives one), the generated-file comment with the hash, then the YAML. */
function withHeader(body: string, license: string | undefined): string {
  const text = [...(license ? [license, ""] : []), ...GENERATED, "", body].join("\n");
  const last = GENERATED[GENERATED.length - 1];
  return text.replace(`${last}\n`, `${last}\n# plan-me:sha256=${hashOf(text)}\n`);
}

function slug(label: string): string {
  return slugify(label.replace(/[^\w ]/g, " ")).replace(/-/g, "_");
}

/** The form elements for the board fields: Component (more than one board), Priority, Role, Size. */
function fieldElements(config: Config): Yaml[] {
  const out: Yaml[] = [];
  const components = Object.keys(config.boards);
  if (components.length > 1) {
    const dflt = components.indexOf(config.defaultComponent);
    out.push({
      type: "dropdown",
      id: "component",
      attributes: {
        label: COMPONENT_HEADING,
        description: "The part of the product it is about (its board).",
        options: components,
        default: dflt >= 0 ? dflt : undefined,
      },
    });
  }
  const f = config.fields;
  const select = (id: string, field: typeof f.priority, description: string): Yaml => {
    const options = Object.values(field.options);
    const dflt = field.default !== undefined ? options.indexOf(field.options[field.default] ?? field.default) : -1;
    return {
      type: "dropdown",
      id,
      attributes: { label: field.name, description, options, default: dflt >= 0 ? dflt : undefined },
    };
  };
  out.push(select("priority", f.priority, `${Object.values(f.priority.options)[0]} is the most urgent.`));
  const roleHelp = "The role that does it.";
  if (Object.keys(f.role.options).length > 0) out.push(select("role", f.role, roleHelp));
  else out.push({ type: "input", id: "role", attributes: { label: f.role.name, description: roleHelp } });
  out.push(select("size", f.size, "A rough size."));
  return out;
}

function sectionElement(s: Section): Yaml {
  return {
    type: s.kind ?? "textarea",
    id: slug(s.label),
    attributes: { label: s.label, description: s.description, placeholder: s.placeholder },
    validations: s.required ? { required: true } : undefined,
  };
}

/** The issue form for one type (without its header). */
export function formFor(config: Config, type: string, native: string | undefined): string {
  const spec = TYPE_SPECS[type.toLowerCase()] ?? { ...TYPE_SPECS.other, description: `A ${type.toLowerCase()}` };
  const numbered = Object.values(config.boards).filter(b => b.number !== undefined);
  const one = Object.keys(config.boards).length === 1 && numbered.length === 1;
  const form: Yaml = {
    name: type,
    description: spec.description,
    type: native,
    labels: native ? undefined : [typeLabel(config, type)],
    projects: one ? [`${config.owner}/${numbered[0].number}`] : undefined,
    body: [
      ...(spec.intro ? [{ type: "markdown", attributes: { value: spec.intro } }] : []),
      ...spec.sections.map(sectionElement),
      ...fieldElements(config),
    ],
  };
  return `${yaml(form, "").join("\n")}\n`;
}

/** The chooser's configuration: blank issues on or off, contact links. */
export function chooserConfig(config: Config): string {
  const links = config.templates.contactLinks.map(l => ({ name: l.name, url: l.url, about: l.about }));
  return `${yaml({ blank_issues_enabled: config.templates.blankIssues, contact_links: links }, "").join("\n")}\n`;
}

/** The file name of a type's form: `<slug>.yml` (`bug.yml`, `feature.yml`). */
export function templateFileName(type: string): string {
  const name = slugify(type);
  return name === "config" ? "type-config.yml" : `${name}.yml`;
}

/** How an existing file stands: missing, written by someone else, edited by hand, or as plan-me wrote it. */
export type FileState = "missing" | "foreign" | "edited" | "generated";

/** The state of a template file (the hash line tells generated from hand-edited). */
export function fileState(text: string | undefined): FileState {
  if (text === undefined) return "missing";
  const m = HASH_LINE.exec(text);
  if (!m) return "foreign";
  return hashOf(text) === m[1] ? "generated" : "edited";
}

function readFile(root: string, rel: string): string | undefined {
  const file = path.join(root, rel);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
}

/** The files plan-me would write (empty when templates are off), given what is on disk now. */
export function templateFiles(root: string, config: Config, opts: TemplateOptions = {}): TemplateFile[] {
  if (!config.templates.enabled) return [];
  const make = (rel: string, body: string, existing: string | undefined): string => {
    const year = (existing && YEAR.exec(existing)?.[1]) ?? opts.year ?? today().slice(0, 4);
    return withHeader(body, yamlLicenseHeader(root, rel, year));
  };
  const files: TemplateFile[] = [];
  for (const type of config.types) {
    const rel = path.posix.join(TEMPLATE_DIR, templateFileName(type));
    const existing = readFile(root, rel);
    let native: string | undefined;
    if (opts.issueTypes) native = opts.issueTypes.find(t => t.toLowerCase() === type.toLowerCase());
    else if (existing && fileState(existing) === "generated" && NATIVE.test(existing)) native = type;
    files.push({ path: rel, type, content: make(rel, formFor(config, type, native), existing) });
  }
  const chooser = path.posix.join(TEMPLATE_DIR, CHOOSER_FILE);
  files.push({ path: chooser, content: make(chooser, chooserConfig(config), readFile(root, chooser)) });
  return files;
}

/** The generated files in TEMPLATE_DIR that no configured type writes any more. */
function leftovers(root: string, files: TemplateFile[]): string[] {
  const dir = path.join(root, TEMPLATE_DIR);
  if (!fs.existsSync(dir)) return [];
  const wanted = new Set(files.map(f => f.path));
  return fs
    .readdirSync(dir)
    .filter(n => /\.ya?ml$/.test(n))
    .sort()
    .map(n => path.posix.join(TEMPLATE_DIR, n))
    .filter(rel => !wanted.has(rel) && fileState(readFile(root, rel)) === "generated");
}

/** What `templates` did: the changes, and the files left alone (edited by hand or not plan-me's). */
export interface TemplatesOutcome {
  actions: string[];
  skipped: string[];
}

/**
 * Writes the issue forms and the chooser configuration. Idempotent: an up-to-date file is not touched; a file edited
 * by hand (or not written by plan-me) is left alone unless `force`; a generated file for a type no longer configured
 * is removed.
 */
export function writeTemplates(
  root: string,
  config: Config,
  opts: TemplateOptions & { force?: boolean; dryRun?: boolean } = {}
): TemplatesOutcome {
  const files = templateFiles(root, config, opts);
  const out: TemplatesOutcome = { actions: [], skipped: [] };
  const would = opts.dryRun ? "would " : "";
  for (const f of files) {
    const existing = readFile(root, f.path);
    const state = fileState(existing);
    if (existing === f.content) continue;
    if ((state === "edited" || state === "foreign") && !opts.force) {
      const why = state === "edited" ? "edited by hand" : "not written by plan-me";
      out.skipped.push(`${f.path} ${why}: left alone (--force overwrites)`);
      continue;
    }
    out.actions.push(`${would}${state === "missing" ? "write" : "update"} ${f.path}`);
    if (opts.dryRun) continue;
    fs.mkdirSync(path.dirname(path.join(root, f.path)), { recursive: true });
    fs.writeFileSync(path.join(root, f.path), f.content);
  }
  for (const rel of leftovers(root, files)) {
    out.actions.push(`${would}remove ${rel}`);
    if (!opts.dryRun) fs.unlinkSync(path.join(root, rel));
  }
  return out;
}

/**
 * Checks the templates against the configuration: one line per generated file that is missing, stale or no longer
 * configured. Files edited by hand are fine (plan-me leaves them alone). A repository whose TEMPLATE_DIR holds no
 * file plan-me generated doesn't use the templates and passes; so does one with `"templates": false`.
 */
export function checkTemplates(root: string, config: Config, opts: TemplateOptions = {}): string[] {
  const dir = path.join(root, TEMPLATE_DIR);
  if (!config.templates.enabled || !fs.existsSync(dir)) return [];
  const used = fs.readdirSync(dir).some(n => HASH_LINE.test(readFile(root, path.posix.join(TEMPLATE_DIR, n)) ?? ""));
  if (!used) return [];
  const problems: string[] = [];
  const files = templateFiles(root, config, opts);
  for (const f of files) {
    const existing = readFile(root, f.path);
    const state = fileState(existing);
    if (state === "missing") problems.push(`${f.path}: missing; run \`plan-me templates\``);
    else if (state === "generated" && existing !== f.content) {
      problems.push(`${f.path}: stale (the configuration changed); run \`plan-me templates\``);
    }
  }
  for (const rel of leftovers(root, files)) {
    problems.push(`${rel}: its type is no longer configured; run \`plan-me templates\``);
  }
  return problems;
}

// --- reading a submitted form ---

/**
 * The answers of a submitted issue form: GitHub writes each element as `### <label>` and the answer (`_No response_`
 * when left empty, which is left out here). Keyed by the heading.
 */
export function parseFormAnswers(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = body.replace(/\r\n/g, "\n").split(/^### +(.+?)[ \t]*$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const answer = parts[i + 1].trim();
    if (answer && answer !== "_No response_" && answer !== "None") out[parts[i]] = answer;
  }
  return out;
}
