/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { FieldSpec, PlanApi, RawIssue } from "./api.js";
import { componentLabel, Config, LabelConfig, SelectField, Status, STATUSES, typeLabel } from "./config.js";
import { appendLine } from "./github.js";
import { compareItems, componentOf, formatSnapshot, isEpic, Item, marker, MARKER, toItem, toItems } from "./item.js";

/** The plan-me field values to write (keys, not option names); undefined fields are left alone. */
export interface FieldValues {
  status?: Status;
  priority?: string;
  role?: string;
  size?: string;
}

/** Filters for `list` and `next`. */
export interface Filters {
  component?: string;
  role?: string;
  status?: Status;
  priority?: string;
  type?: string;
  parent?: number;
  /** open (default), closed or all. */
  state?: "open" | "closed" | "all";
}

/** The input of `new`. */
export interface NewItem {
  title: string;
  body?: string;
  type?: string;
  priority?: string;
  component?: string;
  role?: string;
  size?: string;
  /** The parent epic (a number, `#n` or a marker id). */
  parent?: string;
  /** The blockers (numbers, `#n` or marker ids). */
  blockedBy?: string[];
  /** Design doc paths or URLs, listed as links in the body. */
  design?: string[];
  /** A stable id (hidden marker); `new` with an existing id returns that item unchanged. */
  id?: string;
}

/** What a mutating command did: the item afterwards and whether anything changed. */
export interface Outcome {
  item: Item;
  changed: boolean;
  actions: string[];
}

/** The base URL for design doc links given as repository paths. */
function docsBase(config: Config): string {
  return `https://github.com/${config.repository}/blob/HEAD/`;
}

/**
 * The backlog commands over a PlanApi. Every mutating command is idempotent: run twice, the second run changes
 * nothing and reports `changed: false`.
 */
export class Backlog {
  private openCache?: RawIssue[];

  constructor(
    readonly api: PlanApi,
    readonly config: Config
  ) {}

  /** The open issues (loaded once per instance; mutations invalidate). */
  private async openIssues(): Promise<RawIssue[]> {
    this.openCache ??= await this.api.listIssues(false);
    return this.openCache;
  }

  /**
   * Resolves an item reference: `12`, `#12`, or a marker id (`feel-polish`).
   * @throws When nothing matches
   */
  async resolve(ref: string | number): Promise<number> {
    const text = String(ref).trim();
    const m = /^#?(\d+)$/.exec(text);
    if (m) return +m[1];
    const raws = await this.api.listIssues(true);
    const hit = raws.find(r => MARKER.exec(r.body)?.[1] === text);
    if (!hit) throw new Error(`no issue with id "${text}"`);
    return hit.number;
  }

  private async raw(ref: string | number): Promise<RawIssue> {
    const number = await this.resolve(ref);
    const raw = await this.api.getIssue(number);
    if (!raw) throw new Error(`issue #${number} not found`);
    return raw;
  }

  private async item(raw: RawIssue): Promise<Item> {
    const known = new Map((await this.openIssues()).map(r => [r.number, r]));
    known.set(raw.number, raw);
    return toItem(this.config, raw, known);
  }

  /** Maps plan-me values to board field names and option names; validates keys. */
  private fieldValues(values: FieldValues): Record<string, string> {
    const out: Record<string, string> = {};
    const put = (field: SelectField, key: string | undefined, what: string): void => {
      if (key === undefined) return;
      const free = Object.keys(field.options).length === 0;
      if (!free && !(key in field.options)) {
        throw new Error(`unknown ${what} "${key}" (one of: ${Object.keys(field.options).join(", ")})`);
      }
      out[field.name] = free ? key : field.options[key];
    };
    const f = this.config.fields;
    put(f.status, values.status, "status");
    put(f.priority, values.priority, "priority");
    put(f.role, values.role, "role");
    put(f.size, values.size, "size");
    return out;
  }

  /** Writes the values that differ from the current item; returns the action lines. */
  private async write(raw: RawIssue, current: Item | undefined, values: FieldValues): Promise<string[]> {
    const changed: FieldValues = {};
    const actions: string[] = [];
    for (const key of ["status", "priority", "role", "size"] as const) {
      const value = values[key];
      if (value !== undefined && (current === undefined || current[key] !== value)) {
        (changed as Record<string, string>)[key] = value;
        actions.push(`${key} ${current?.[key] ?? "-"} -> ${value}`);
      }
    }
    if (actions.length === 0) return [];
    const board = this.config.boards[componentOf(this.config, raw)];
    if (!board) throw new Error(`no board for component "${componentOf(this.config, raw)}" in the config`);
    await this.api.setFields(raw, board, this.fieldValues(changed));
    this.openCache = undefined;
    return actions;
  }

  /** The board fields plan-me needs on every board. */
  fieldSpecs(): FieldSpec[] {
    const f = this.config.fields;
    return [f.status, f.priority, f.role, f.size].map(s => ({ name: s.name, options: Object.values(s.options) }));
  }

  /** The labels plan-me needs: one per component, one per type the repository has no issue type for, the extras. */
  async labels(): Promise<LabelConfig[]> {
    const { issueTypes } = await this.api.features();
    const have = issueTypes.map(t => t.toLowerCase());
    return [
      ...Object.keys(this.config.boards).map(c => ({ name: componentLabel(this.config, c), color: "1d76db" })),
      ...this.config.types
        .filter(t => !have.includes(t.toLowerCase()))
        .map(t => ({ name: typeLabel(this.config, t), color: "c5def5" })),
      ...this.config.labels,
    ];
  }

  /** `init`: creates the missing boards, fields, options and labels. Returns one line per action. */
  async init(dryRun: boolean): Promise<string[]> {
    const actions = await this.api.ensureLabels(await this.labels(), dryRun);
    for (const board of Object.values(this.config.boards)) {
      actions.push(...(await this.api.ensureBoard(board, this.fieldSpecs(), dryRun)));
    }
    return actions;
  }

  /**
   * `new`: creates an item (or returns the one with the same `id`).
   * @param checkId Look for an existing item with the same id first (the importer has already)
   */
  async create(input: NewItem, checkId = true): Promise<Outcome> {
    if (input.id && checkId) {
      const existing = (await this.api.listIssues(true)).find(r => MARKER.exec(r.body)?.[1] === input.id);
      if (existing) return { item: await this.item(existing), changed: false, actions: [] };
    }
    const component = input.component ?? this.config.defaultComponent;
    if (component && !this.config.boards[component]) throw new Error(`unknown component "${component}"`);
    const { issueTypes } = await this.api.features();
    const labels = component ? [componentLabel(this.config, component)] : [];
    let issueType: string | undefined;
    if (input.type) {
      issueType = issueTypes.find(t => t.toLowerCase() === input.type?.toLowerCase());
      if (!issueType) labels.push(typeLabel(this.config, input.type));
    }
    const body = this.body(input);
    const priority = input.priority ?? this.config.fields.priority.default;
    this.fieldValues({ priority, role: input.role, size: input.size }); // validate before creating
    const parent = input.parent ? await this.raw(input.parent) : undefined;
    const blockers = await Promise.all((input.blockedBy ?? []).map(async b => this.raw(b)));

    let raw = await this.api.createIssue({ title: input.title, body, labels, issueType });
    const actions = [`created #${raw.number}`];
    if (parent) {
      await this.api.addSubIssue(parent, raw);
      actions.push(`parent #${parent.number}`);
    }
    for (const blocker of blockers) {
      await this.api.addBlockedBy(raw, blocker);
      actions.push(`blocked by #${blocker.number}`);
    }
    const status: Status = blockers.some(b => b.open) ? "blocked" : "open";
    actions.push(...(await this.write(raw, undefined, { status, priority, role: input.role, size: input.size })));
    raw = (await this.api.getIssue(raw.number)) ?? raw;
    return { item: await this.item(raw), changed: true, actions };
  }

  private body(input: NewItem): string {
    const parts = [input.body?.trim() ?? ""];
    if (input.design && input.design.length > 0) {
      const links = input.design.map(d => `- [${d}](${/^https?:/.test(d) ? d : docsBase(this.config) + d})`);
      parts.push(["Design:", ...links].join("\n"));
    }
    if (input.id) parts.push(marker(input.id));
    return parts.filter(Boolean).join("\n\n") + "\n";
  }

  /**
   * Sets a status (reopening a closed issue unless the status is done); idempotent.
   * @param force Write the field even when the derived status already matches (an empty field reads as open)
   */
  async setStatus(ref: string | number, status: Status, force = false): Promise<Outcome> {
    if (!STATUSES.includes(status)) throw new Error(`unknown status "${status}"`);
    const raw = await this.raw(ref);
    const actions: string[] = [];
    if (!raw.open && status !== "done") {
      await this.api.setOpen(raw.number, true);
      raw.open = true;
      actions.push("reopened");
    }
    const current = force ? undefined : await this.item(raw);
    actions.push(...(await this.write(raw, current, { status })));
    const after = (await this.api.getIssue(raw.number)) ?? raw;
    return { item: await this.item(after), changed: actions.length > 0, actions };
  }

  /** Sets priority, role or size (status has its own commands); idempotent. */
  async update(ref: string | number, values: Omit<FieldValues, "status">): Promise<Outcome> {
    const raw = await this.raw(ref);
    const actions = await this.write(raw, await this.item(raw), values);
    const after = actions.length > 0 ? ((await this.api.getIssue(raw.number)) ?? raw) : raw;
    return { item: await this.item(after), changed: actions.length > 0, actions };
  }

  /** `start`: status in-progress; the branch (if given) as a `Branch: b` body line. */
  async start(ref: string | number, branch?: string): Promise<Outcome> {
    const raw = await this.raw(ref);
    const actions: string[] = [];
    if (branch) {
      const body = appendLine(raw.body, `Branch: ${branch}`);
      if (body !== raw.body) {
        await this.api.updateBody(raw.number, body);
        actions.push(`branch ${branch}`);
      }
    }
    const outcome = await this.setStatus(raw.number, "in-progress");
    return { ...outcome, changed: outcome.changed || actions.length > 0, actions: [...actions, ...outcome.actions] };
  }

  /** `block`: `ref` is blocked by `by` (native dependency or body line); status blocked while `by` is open. */
  async block(ref: string | number, by: string | number): Promise<Outcome> {
    const raw = await this.raw(ref);
    const blocker = await this.raw(by);
    if (raw.number === blocker.number) throw new Error("an issue can't block itself");
    const actions: string[] = [];
    if (!raw.blockedBy.some(b => b.number === blocker.number)) {
      await this.api.addBlockedBy(raw, blocker);
      actions.push(`blocked by #${blocker.number}`);
    }
    if (blocker.open) {
      const outcome = await this.setStatus(raw.number, "blocked");
      actions.push(...outcome.actions);
      return { item: outcome.item, changed: actions.length > 0, actions };
    }
    const after = (await this.api.getIssue(raw.number)) ?? raw;
    return { item: await this.item(after), changed: actions.length > 0, actions };
  }

  /** Makes `ref` a sub-issue of `parent`; idempotent. */
  async setParent(ref: string | number, parent: string | number): Promise<Outcome> {
    const raw = await this.raw(ref);
    const epic = await this.raw(parent);
    if (raw.parent === epic.number || epic.children.some(c => c.number === raw.number)) {
      return { item: await this.item(raw), changed: false, actions: [] };
    }
    await this.api.addSubIssue(epic, raw);
    const after = (await this.api.getIssue(raw.number)) ?? raw;
    return { item: await this.item(after), changed: true, actions: [`parent #${epic.number}`] };
  }

  /** `decide`: status needs-decision; the question (if given) as a comment when the status changes. */
  async decide(ref: string | number, question?: string): Promise<Outcome> {
    const outcome = await this.setStatus(ref, "needs-decision");
    if (outcome.changed && question) {
      await this.api.comment(outcome.item.number, `**Needs decision:** ${question}`);
      outcome.actions.push("comment");
    }
    return outcome;
  }

  /** `done`: a Done comment (when still open), closed, status done; idempotent. */
  async done(ref: string | number, note?: string): Promise<Outcome> {
    const raw = await this.raw(ref);
    const actions: string[] = [];
    if (raw.open) {
      await this.api.comment(raw.number, `**Done.**${note ? ` ${note}` : ""}`);
      await this.api.setOpen(raw.number, false);
      actions.push("comment", "closed");
    }
    const current = await this.item({ ...raw, open: true });
    actions.push(...(await this.write(raw, current, { status: "done" })));
    raw.open = false;
    return { item: await this.item(raw), changed: actions.length > 0, actions };
  }

  /** `list`: the items matching the filters, in `next` order. */
  async list(filters: Filters = {}): Promise<Item[]> {
    const state = filters.state ?? "open";
    const raws = state === "open" ? await this.openIssues() : await this.api.listIssues(true);
    const items = toItems(this.config, raws, state !== "open").filter(
      i =>
        (state === "all" || (state === "open") === i.open) &&
        (filters.component === undefined || i.component === filters.component) &&
        (filters.role === undefined || i.role === filters.role) &&
        (filters.status === undefined || i.status === filters.status) &&
        (filters.priority === undefined || i.priority === filters.priority) &&
        (filters.type === undefined || i.type?.toLowerCase() === filters.type.toLowerCase()) &&
        (filters.parent === undefined || i.parent === filters.parent)
    );
    return items.sort((a, b) => compareItems(this.config, a, b));
  }

  /**
   * `next`: the open, unblocked, non-epic items in pick-up order (P1 before P2 before P3; within a priority
   * in-progress and needs-decision first, then by number).
   * @param limit How many to return (default 1)
   */
  async next(filters: Filters = {}, limit = 1): Promise<Item[]> {
    const items = await this.list({ ...filters, state: "open" });
    return items
      .filter(i => i.status !== "blocked" && i.blockedBy.length === 0 && !isEpic(this.config, i))
      .slice(0, limit);
  }

  /** `show`: one item with its body. */
  async show(ref: string | number): Promise<Item & { body: string }> {
    const raw = await this.raw(ref);
    return { ...(await this.item(raw)), body: raw.body };
  }

  /** `snapshot`: the open backlog as text, one line per item (see formatSnapshot). */
  async snapshot(): Promise<string> {
    return formatSnapshot(this.config, toItems(this.config, await this.openIssues(), false));
  }
}
