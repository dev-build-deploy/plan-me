/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import * as fs from "fs";
import * as path from "path";

import { CONFIG_FILE } from "./config";

/**
 * Every repository that uses plan-me also uses its Claude Code plugin: the repository's shared Claude Code settings
 * (`.claude/settings.json`) enable `plan-me@dev-build-deploy` and name the marketplace it comes from. There is no
 * opt-out.
 */
export const CLAUDE_SETTINGS = ".claude/settings.json";
export const PLUGIN = "plan-me@dev-build-deploy";
export const MARKETPLACE = "dev-build-deploy";
export const MARKETPLACE_REPO = "dev-build-deploy/claude-plugins";

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads the settings file: undefined when missing; throws on JSON that isn't an object. */
function readSettings(root: string): Json | undefined {
  const file = path.join(root, CLAUDE_SETTINGS);
  if (!fs.existsSync(file)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${CLAUDE_SETTINGS}: not valid JSON (${(e as Error).message})`);
  }
  if (!isObject(parsed)) throw new Error(`${CLAUDE_SETTINGS}: not a JSON object`);
  return parsed;
}

/** What is missing from the settings (one line each; empty: complete). */
function missing(settings: Json | undefined): string[] {
  const problems: string[] = [];
  const enabled = settings?.enabledPlugins;
  if (!isObject(enabled) || enabled[PLUGIN] !== true) {
    problems.push(`${CLAUDE_SETTINGS}: enabledPlugins["${PLUGIN}"] is not true`);
  }
  const markets = settings?.extraKnownMarketplaces;
  const source = isObject(markets) && isObject(markets[MARKETPLACE]) ? markets[MARKETPLACE].source : undefined;
  if (!isObject(source) || source.source !== "github" || source.repo !== MARKETPLACE_REPO) {
    problems.push(
      `${CLAUDE_SETTINGS}: extraKnownMarketplaces["${MARKETPLACE}"] does not point to github ${MARKETPLACE_REPO}`
    );
  }
  return problems;
}

/**
 * Checks that a repository using plan-me (it has the configuration file) enables the plan-me Claude Code plugin.
 * A repository without the configuration file passes.
 * @param root The repository root
 * @param configFile The configuration file, relative to the root
 * @returns One line per problem (empty: fine)
 */
export function checkClaudeSettings(root: string, configFile: string = CONFIG_FILE): string[] {
  if (!fs.existsSync(path.resolve(root, configFile))) return [];
  let settings: Json | undefined;
  try {
    settings = readSettings(root);
  } catch (e) {
    return [(e as Error).message];
  }
  return missing(settings).map(
    p => `${p}; run \`plan-me claude install\` (every plan-me repository uses its Claude Code plugin)`
  );
}

/**
 * Writes or merges `.claude/settings.json` so it enables the plan-me plugin, keeping everything else in the file.
 * Idempotent.
 * @param root The repository root
 * @param dryRun Only report what would change
 * @returns One line per change (empty: up to date)
 */
export function installClaudeSettings(root: string, dryRun = false): string[] {
  const before = readSettings(root);
  if (missing(before).length === 0) return [];
  const settings: Json = { ...(before ?? {}) };
  settings.enabledPlugins = { ...(isObject(settings.enabledPlugins) ? settings.enabledPlugins : {}), [PLUGIN]: true };
  const markets = isObject(settings.extraKnownMarketplaces) ? settings.extraKnownMarketplaces : {};
  settings.extraKnownMarketplaces = {
    ...markets,
    [MARKETPLACE]: {
      ...(isObject(markets[MARKETPLACE]) ? markets[MARKETPLACE] : {}),
      source: { source: "github", repo: MARKETPLACE_REPO },
    },
  };
  if (!dryRun) {
    fs.mkdirSync(path.join(root, path.dirname(CLAUDE_SETTINGS)), { recursive: true });
    fs.writeFileSync(path.join(root, CLAUDE_SETTINGS), `${JSON.stringify(settings, null, 2)}\n`);
  }
  const verb = dryRun ? (before ? "would update" : "would create") : before ? "updated" : "created";
  return [`${verb} ${CLAUDE_SETTINGS}: plugin ${PLUGIN} enabled, marketplace ${MARKETPLACE} (${MARKETPLACE_REPO})`];
}

/**
 * The repository root for a working directory: the nearest folder upwards holding the configuration file, else the
 * directory itself. Lets the MCP server started in a subfolder still find `.plan-me.json` and `docs/decisions/`.
 */
export function findRoot(cwd: string, configFile: string = CONFIG_FILE): string {
  if (path.isAbsolute(configFile)) return cwd;
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, configFile))) return dir;
    if (fs.existsSync(path.join(dir, ".git")) || path.dirname(dir) === dir) return cwd;
  }
}
