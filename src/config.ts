/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import fs from "fs";

/** The workflow states plan-me knows, in their canonical (key) spelling. */
export const STATUSES = ["open", "in-progress", "needs-decision", "blocked", "done"] as const;
export type Status = (typeof STATUSES)[number];

/** A board (GitHub Projects v2) for one component; found by title, or by number when given. */
export interface BoardConfig {
  title: string;
  number?: number;
}

/** A single-select field: its name on the board and the key -> option name map (keys are what plan-me prints). */
export interface SelectField {
  name: string;
  options: Record<string, string>;
  default?: string;
}

/** A label plan-me creates on `init`. */
export interface LabelConfig {
  name: string;
  color?: string;
  description?: string;
}

/** The resolved configuration (all defaults applied). */
export interface Config {
  repository: string;
  owner: string;
  boards: Record<string, BoardConfig>;
  defaultComponent: string;
  componentLabelPrefix: string;
  fields: {
    status: SelectField;
    priority: SelectField;
    size: SelectField;
    /** Options empty: a free text field. */
    role: SelectField;
  };
  types: string[];
  typeLabelPrefix: string;
  epicType: string;
  labels: LabelConfig[];
  branchPattern: string;
}

/** The configuration file name looked up in the working directory. */
export const CONFIG_FILE = ".plan-me.json";

const DEFAULT_STATUS_OPTIONS: Record<Status, string> = {
  open: "Todo",
  "in-progress": "In Progress",
  "needs-decision": "Needs decision",
  blocked: "Blocked",
  done: "Done",
};
const DEFAULT_PRIORITIES = ["P1", "P2", "P3"];
const DEFAULT_PRIORITY = "P2";
const DEFAULT_SIZES = ["XS", "S", "M", "L", "XL"];
const DEFAULT_TYPES = ["Feature", "Bug", "Task", "Design", "Decision", "Epic"];
const DEFAULT_BRANCH_PATTERN = "(?:^|/)(\\d+)(?=[-_/]|$)";

type RawSelect = { name?: string; options?: Record<string, string> | string[]; default?: string };
type RawConfig = {
  repository?: string;
  owner?: string;
  boards?: Record<string, string | number | { title?: string; number?: number }>;
  defaultComponent?: string;
  componentLabelPrefix?: string;
  fields?: { status?: RawSelect; priority?: RawSelect; size?: RawSelect; role?: RawSelect };
  types?: string[];
  typeLabelPrefix?: string;
  epicType?: string;
  labels?: (string | LabelConfig)[];
  branchPattern?: string;
};

function toOptions(raw: Record<string, string> | string[] | undefined, fallback: string[]): Record<string, string> {
  if (raw === undefined) return Object.fromEntries(fallback.map(o => [o, o]));
  if (Array.isArray(raw)) return Object.fromEntries(raw.map(o => [o, o]));
  return { ...raw };
}

function toSelect(raw: RawSelect | undefined, name: string, fallback: string[], dflt?: string): SelectField {
  return { name: raw?.name ?? name, options: toOptions(raw?.options, fallback), default: raw?.default ?? dflt };
}

/**
 * Resolves a raw configuration object (as parsed from `.plan-me.json`) into a full Config with defaults.
 * @param raw The parsed JSON
 * @param repository Overrides `repository` (e.g. GITHUB_REPOSITORY in the Action)
 * @returns The resolved configuration
 * @throws When no repository is known or a status key is unknown
 */
export function resolveConfig(raw: RawConfig, repository?: string): Config {
  const repo = repository ?? raw.repository;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`config: "repository" must be "owner/name"`);
  const boards: Record<string, BoardConfig> = {};
  for (const [component, b] of Object.entries(raw.boards ?? {})) {
    if (typeof b === "string") boards[component] = { title: b };
    else if (typeof b === "number") boards[component] = { title: component, number: b };
    else boards[component] = { title: b.title ?? component, number: b.number };
  }
  const components = Object.keys(boards);
  const status = toSelect(raw.fields?.status, "Status", []);
  status.options = { ...DEFAULT_STATUS_OPTIONS, ...status.options };
  for (const key of Object.keys(status.options)) {
    if (!(STATUSES as readonly string[]).includes(key)) throw new Error(`config: unknown status "${key}"`);
  }
  const labels = (raw.labels ?? []).map(l => (typeof l === "string" ? { name: l } : l));
  return {
    repository: repo,
    owner: raw.owner ?? repo.split("/")[0],
    boards,
    defaultComponent: raw.defaultComponent ?? components[0] ?? "",
    componentLabelPrefix: raw.componentLabelPrefix ?? "component:",
    fields: {
      status,
      priority: toSelect(raw.fields?.priority, "Priority", DEFAULT_PRIORITIES, DEFAULT_PRIORITY),
      size: toSelect(raw.fields?.size, "Size", DEFAULT_SIZES),
      role: toSelect(raw.fields?.role, "Role", []),
    },
    types: raw.types ?? DEFAULT_TYPES,
    typeLabelPrefix: raw.typeLabelPrefix ?? "type:",
    epicType: raw.epicType ?? "Epic",
    labels,
    branchPattern: raw.branchPattern ?? DEFAULT_BRANCH_PATTERN,
  };
}

/**
 * Loads and resolves the configuration file.
 * @param file Path to the file (default `.plan-me.json`); a missing file yields defaults when `repository` is given
 * @param repository Overrides the configured repository
 * @returns The resolved configuration
 */
export function loadConfig(file: string = CONFIG_FILE, repository?: string): Config {
  const raw: RawConfig = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  return resolveConfig(raw, repository);
}

/** The ordered priority keys (P1 first). */
export function priorityKeys(config: Config): string[] {
  return Object.keys(config.fields.priority.options);
}

/** The component label for a component name (e.g. `component:engine`). */
export function componentLabel(config: Config, component: string): string {
  return `${config.componentLabelPrefix}${component}`;
}

/** The fallback label for an issue type the organization doesn't have (e.g. `type:design`). */
export function typeLabel(config: Config, type: string): string {
  return `${config.typeLabelPrefix}${type.toLowerCase()}`;
}
