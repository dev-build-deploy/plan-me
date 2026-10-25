/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { BoardConfig, LabelConfig } from "./config";

/** A link to another issue with its state (undefined: unknown, e.g. read from a fallback body line). */
export interface Link {
  number: number;
  open?: boolean;
}

/** An issue as the API layer returns it: raw GitHub data, no plan-me interpretation yet. */
export interface RawIssue {
  nodeId: string;
  number: number;
  title: string;
  body: string;
  open: boolean;
  url: string;
  labels: string[];
  issueType?: string;
  parent?: number;
  children: Link[];
  blockedBy: Link[];
  blocking: Link[];
  /** Board title -> field name -> value (option name or text). */
  boards: Record<string, Record<string, string>>;
}

/** What the repository supports natively; the API layer falls back to body lines when a feature is missing. */
export interface Features {
  subIssues: boolean;
  dependencies: boolean;
  /** The issue types available to the repository (empty: labels are used instead). */
  issueTypes: string[];
}

/** A board field plan-me needs: single select with options, or text when `options` is empty. */
export interface FieldSpec {
  name: string;
  options: string[];
}

/** The input for a new issue. */
export interface NewIssue {
  title: string;
  body: string;
  labels: string[];
  issueType?: string;
}

/**
 * The GitHub operations plan-me needs. `GitHubApi` implements it with Octokit; tests use an in-memory fake.
 */
export interface PlanApi {
  /** Detects the native features (sub-issues, dependencies, issue types); cached per instance. */
  features(): Promise<Features>;
  /** Lists the repository's issues (open only unless `includeClosed`), with board fields, parents and blockers. */
  listIssues(includeClosed: boolean): Promise<RawIssue[]>;
  /** Fetches one issue; undefined when it doesn't exist (or is a pull request). */
  getIssue(number: number): Promise<RawIssue | undefined>;
  /** Creates an issue. */
  createIssue(input: NewIssue): Promise<RawIssue>;
  /** Replaces an issue's body. */
  updateBody(number: number, body: string): Promise<void>;
  /** Adds labels to an issue (existing labels are kept). */
  addLabels(number: number, labels: string[]): Promise<void>;
  /** Adds a comment. */
  comment(number: number, body: string): Promise<void>;
  /** Opens or closes (as completed) an issue. */
  setOpen(number: number, open: boolean): Promise<void>;
  /** Makes `child` a sub-issue of `parent` (a `Parent: #n` body line without native sub-issues). */
  addSubIssue(parent: RawIssue, child: RawIssue): Promise<void>;
  /** Marks `issue` as blocked by `blocker` (a `Blocked by #n` body line without native dependencies). */
  addBlockedBy(issue: RawIssue, blocker: RawIssue): Promise<void>;
  /** Adds the issue to the board (idempotent) and sets field values (field name -> option name or text). */
  setFields(issue: RawIssue, board: BoardConfig, values: Record<string, string>): Promise<void>;
  /** Creates the missing labels; returns one line per action (taken, or planned on a dry run). */
  ensureLabels(labels: LabelConfig[], dryRun: boolean): Promise<string[]>;
  /** Creates the board and its missing fields and options; returns one line per action. */
  ensureBoard(board: BoardConfig, fields: FieldSpec[], dryRun: boolean): Promise<string[]>;
}
