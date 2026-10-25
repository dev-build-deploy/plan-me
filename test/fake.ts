/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { Features, FieldSpec, NewIssue, PlanApi, RawIssue } from "../src/api.js";
import { Backlog } from "../src/backlog.js";
import { BoardConfig, LabelConfig, resolveConfig } from "../src/config.js";

/** An in-memory PlanApi: issues, comments, labels and boards, with live link states. */
export class FakeApi implements PlanApi {
  issues = new Map<number, RawIssue>();
  comments = new Map<number, string[]>();
  labels = new Set<string>();
  boards = new Map<string, Set<string>>();
  calls: string[] = [];
  private counter = 1;

  constructor(
    readonly feat: Features = { subIssues: true, dependencies: true, issueTypes: ["Feature", "Bug", "Task"] }
  ) {}

  async features(): Promise<Features> {
    return this.feat;
  }

  private copy(raw: RawIssue): RawIssue {
    const live = (n: number): boolean => this.issues.get(n)?.open ?? false;
    return {
      ...raw,
      labels: [...raw.labels],
      children: raw.children.map(c => ({ number: c.number, open: live(c.number) })),
      blockedBy: raw.blockedBy.map(c => ({ number: c.number, open: live(c.number) })),
      blocking: [...this.issues.values()]
        .filter(i => i.blockedBy.some(b => b.number === raw.number))
        .map(i => ({ number: i.number, open: i.open })),
      boards: JSON.parse(JSON.stringify(raw.boards)),
    };
  }

  async listIssues(includeClosed: boolean): Promise<RawIssue[]> {
    return [...this.issues.values()].filter(i => includeClosed || i.open).map(i => this.copy(i));
  }

  async getIssue(number: number): Promise<RawIssue | undefined> {
    const raw = this.issues.get(number);
    return raw && this.copy(raw);
  }

  /** Adds an issue directly (test set-up). */
  add(partial: Partial<RawIssue> & { title: string }): RawIssue {
    const number = this.counter++;
    const raw: RawIssue = {
      nodeId: `I_${number}`,
      number,
      body: "",
      open: true,
      url: `https://github.com/o/r/issues/${number}`,
      labels: [],
      children: [],
      blockedBy: [],
      blocking: [],
      boards: {},
      ...partial,
    };
    this.issues.set(number, raw);
    return raw;
  }

  async createIssue(input: NewIssue): Promise<RawIssue> {
    this.calls.push(`create ${input.title}`);
    return this.copy(
      this.add({ title: input.title, body: input.body, labels: input.labels, issueType: input.issueType })
    );
  }

  private get(number: number): RawIssue {
    const raw = this.issues.get(number);
    if (!raw) throw new Error(`no #${number}`);
    return raw;
  }

  async updateBody(number: number, body: string): Promise<void> {
    this.calls.push(`body #${number}`);
    this.get(number).body = body;
  }

  async addLabels(number: number, labels: string[]): Promise<void> {
    this.get(number).labels.push(...labels);
  }

  async comment(number: number, body: string): Promise<void> {
    this.calls.push(`comment #${number}`);
    this.comments.set(number, [...(this.comments.get(number) ?? []), body]);
  }

  async setOpen(number: number, open: boolean): Promise<void> {
    this.calls.push(`${open ? "open" : "close"} #${number}`);
    this.get(number).open = open;
  }

  async addSubIssue(parent: RawIssue, child: RawIssue): Promise<void> {
    this.calls.push(`sub #${parent.number} #${child.number}`);
    this.get(child.number).parent = parent.number;
    this.get(parent.number).children.push({ number: child.number });
  }

  async addBlockedBy(issue: RawIssue, blocker: RawIssue): Promise<void> {
    this.calls.push(`blockedBy #${issue.number} #${blocker.number}`);
    this.get(issue.number).blockedBy.push({ number: blocker.number });
  }

  async setFields(issue: RawIssue, board: BoardConfig, values: Record<string, string>): Promise<void> {
    this.calls.push(`fields #${issue.number} ${JSON.stringify(values)}`);
    const raw = this.get(issue.number);
    raw.boards[board.title] = { ...(raw.boards[board.title] ?? {}), ...values };
  }

  async ensureLabels(labels: LabelConfig[], dryRun: boolean): Promise<string[]> {
    const missing = labels.filter(l => !this.labels.has(l.name));
    if (!dryRun) missing.forEach(l => this.labels.add(l.name));
    return missing.map(l => `create label ${l.name}`);
  }

  async ensureBoard(board: BoardConfig, fields: FieldSpec[], dryRun: boolean): Promise<string[]> {
    const have = this.boards.get(board.title);
    const missing = fields.filter(f => !have?.has(f.name));
    const actions = [
      ...(have ? [] : [`create board "${board.title}"`]),
      ...missing.map(f => `create field "${f.name}"`),
    ];
    if (!dryRun) this.boards.set(board.title, new Set(fields.map(f => f.name)));
    return actions;
  }
}

/** A test configuration: components engine and game; roles lead, helper, user. */
export const CONFIG = resolveConfig({
  repository: "o/r",
  boards: { engine: "Engine", game: "Game" },
  defaultComponent: "game",
  fields: { role: { options: ["lead", "helper", "user"] } },
});

/** A fresh fake and a backlog over it. */
export function setup(features?: Features): { api: FakeApi; backlog: Backlog } {
  const api = new FakeApi(features);
  return { api, backlog: new Backlog(api, CONFIG) };
}
