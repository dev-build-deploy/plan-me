/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import fs from "fs";
import path from "path";

import { checkClaudeSettings, CLAUDE_SETTINGS, findRoot, installClaudeSettings, PLUGIN } from "../src/claude";

import { repo } from "./repo";

const CONFIG = '{ "repository": "octo-org/notes" }\n';
const read = (root: string): Record<string, Record<string, unknown>> =>
  JSON.parse(fs.readFileSync(path.join(root, CLAUDE_SETTINGS), "utf8"));

describe("Claude Code plugin settings", () => {
  test("a repository without .plan-me.json passes the check", () => {
    expect(checkClaudeSettings(repo())).toEqual([]);
  });

  test("a plan-me repository without the settings fails, then install fixes it", () => {
    const root = repo({ ".plan-me.json": CONFIG });
    const problems = checkClaudeSettings(root);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain(`enabledPlugins["${PLUGIN}"]`);
    expect(problems[1]).toContain("extraKnownMarketplaces");
    expect(problems[0]).toContain("plan-me claude install");

    expect(installClaudeSettings(root, true)[0]).toMatch(/^would create /);
    expect(fs.existsSync(path.join(root, CLAUDE_SETTINGS))).toBe(false);

    expect(installClaudeSettings(root)[0]).toMatch(/^created /);
    expect(read(root)).toEqual({
      enabledPlugins: { [PLUGIN]: true },
      extraKnownMarketplaces: {
        "dev-build-deploy": { source: { source: "github", repo: "dev-build-deploy/claude-plugins" } },
      },
    });
    expect(checkClaudeSettings(root)).toEqual([]);
    expect(installClaudeSettings(root)).toEqual([]); // idempotent: up to date
  });

  test("install keeps everything else in the file", () => {
    const root = repo({
      ".plan-me.json": CONFIG,
      [CLAUDE_SETTINGS]: JSON.stringify({
        permissions: { allow: ["Bash(npm test)"] },
        enabledPlugins: { "other@market": true, [PLUGIN]: false },
        extraKnownMarketplaces: { market: { source: { source: "github", repo: "o/m" } } },
      }),
    });
    expect(installClaudeSettings(root)[0]).toMatch(/^updated /);
    const s = read(root);
    expect(s.permissions).toEqual({ allow: ["Bash(npm test)"] });
    expect(s.enabledPlugins).toEqual({ "other@market": true, [PLUGIN]: true });
    expect(Object.keys(s.extraKnownMarketplaces)).toEqual(["market", "dev-build-deploy"]);
  });

  test("a wrong marketplace source fails; invalid JSON is reported, not overwritten", () => {
    const root = repo({
      ".plan-me.json": CONFIG,
      [CLAUDE_SETTINGS]: JSON.stringify({
        enabledPlugins: { [PLUGIN]: true },
        extraKnownMarketplaces: { "dev-build-deploy": { source: { source: "github", repo: "someone/else" } } },
      }),
    });
    expect(checkClaudeSettings(root)).toHaveLength(1);
    const broken = repo({ ".plan-me.json": CONFIG, [CLAUDE_SETTINGS]: "{ nope" });
    expect(checkClaudeSettings(broken)[0]).toContain("not valid JSON");
    expect(() => installClaudeSettings(broken)).toThrow("not valid JSON");
  });

  test("a custom configuration file is the one that counts", () => {
    const root = repo({ "config/plan.json": CONFIG });
    expect(checkClaudeSettings(root)).toEqual([]);
    expect(checkClaudeSettings(root, "config/plan.json")).toHaveLength(2);
  });

  test("findRoot walks up to the folder holding the configuration", () => {
    const root = repo({ ".plan-me.json": CONFIG, "web/src/x.ts": "" });
    expect(findRoot(path.join(root, "web", "src"))).toBe(root);
    const plain = repo({ ".git/HEAD": "", "a/b": "" });
    expect(findRoot(path.join(plain, "a"))).toBe(path.join(plain, "a"));
  });
});
