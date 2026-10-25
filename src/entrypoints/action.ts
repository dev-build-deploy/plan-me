/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import * as core from "@actions/core";
import * as github from "@actions/github";

import { onIssueClosed, onPullRequest, sweep } from "../automation.js";
import { Backlog } from "../backlog.js";
import { loadConfig } from "../config.js";
import { GitHubApi, OctokitLike } from "../github.js";

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
 * Main entry point for the GitHub Action.
 */
async function run(): Promise<void> {
  try {
    const config = loadConfig(core.getInput("config") || undefined, process.env.GITHUB_REPOSITORY);
    const octokit = github.getOctokit(core.getInput("token", { required: true })) as unknown as OctokitLike;
    const backlog = new Backlog(new GitHubApi(octokit, config.repository, config.owner), config);
    const lines = await handle(backlog);
    lines.forEach(l => core.info(l));
    if (lines.length === 0) core.info("plan-me: nothing to change");
    core.setOutput("changes", JSON.stringify(lines));
  } catch (e) {
    core.setFailed((e as Error).message);
  }
}

run();
