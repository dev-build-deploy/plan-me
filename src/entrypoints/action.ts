/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import * as core from "@actions/core";
import * as github from "@actions/github";

import { onIssueClosed, onPullRequest, sweep } from "../automation";
import { Backlog } from "../backlog";
import { checkClaudeSettings } from "../claude";
import { loadConfig } from "../config";
import { checkDecisions } from "../decisions";
import { GitHubApi, OctokitLike } from "../github";
import { versionWarning } from "../version";

type PullRequestPayload = { number: number; merged?: boolean; body?: string | null; head: { ref: string } };

/** Routes the event to the automation; returns one line per change. */
async function handle(backlog: Backlog): Promise<string[]> {
  const { eventName, payload } = github.context;
  if (eventName === "pull_request" || eventName === "pull_request_target") {
    const pr = payload.pull_request as PullRequestPayload;
    return onPullRequest(backlog, {
      number: pr.number,
      action: payload.action ?? "",
      merged: !!pr.merged,
      body: pr.body ?? "",
      branch: pr.head.ref,
    });
  }
  if (eventName === "issues" && payload.issue) {
    const number: number = payload.issue.number;
    if (payload.action === "closed") return onIssueClosed(backlog, number);
    return sweep(backlog, [number]);
  }
  return sweep(backlog);
}

/**
 * `decisions check` on the checked-out repository (the workspace): one error annotation per problem. A repository
 * without decision files passes; without a checkout there is nothing to check.
 * @returns Whether the decisions are clean
 */
function checkDecisionFiles(): boolean {
  const root = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const problems = checkDecisions(root);
  problems.forEach(p => core.error(p));
  core.info(problems.length > 0 ? `plan-me: ${problems.length} decision problem(s)` : "plan-me: decisions ok");
  return problems.length === 0;
}

/**
 * The plan-me Claude Code plugin is a must: a repository with the configuration file enables it in
 * `.claude/settings.json`. One error annotation per problem.
 * @returns Whether the settings are complete
 */
function checkClaudePlugin(): boolean {
  const root = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const problems = checkClaudeSettings(root, core.getInput("config") || undefined);
  problems.forEach(p => core.error(p));
  core.info(problems.length > 0 ? "plan-me: the Claude Code plugin is not enabled" : "plan-me: Claude Code plugin ok");
  return problems.length === 0;
}

/**
 * Main entry point for the GitHub Action.
 */
async function run(): Promise<void> {
  const decisionsClean = checkDecisionFiles();
  const pluginClean = checkClaudePlugin();
  try {
    const config = loadConfig(core.getInput("config") || undefined, process.env.GITHUB_REPOSITORY);
    const warning = versionWarning(config.version);
    if (warning) core.warning(warning.replace(/^warning: /, ""));
    const octokit = github.getOctokit(core.getInput("token", { required: true })) as unknown as OctokitLike;
    const backlog = new Backlog(new GitHubApi(octokit, config.repository, config.owner), config);
    const lines = await handle(backlog);
    lines.forEach(l => core.info(l));
    if (lines.length === 0) core.info("plan-me: nothing to change");
    core.setOutput("changes", JSON.stringify(lines));
    if (!decisionsClean) core.setFailed("plan-me: the decisions check failed (run `plan-me decisions check`)");
    if (!pluginClean) core.setFailed("plan-me: the Claude Code plugin is not enabled (run `plan-me claude install`)");
  } catch (e) {
    core.setFailed((e as Error).message);
  }
}

run();
