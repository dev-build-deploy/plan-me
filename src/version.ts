/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import fs from "fs";

import { ltr, minVersion, satisfies, validRange } from "semver";

import pkg from "../package.json";

/** This plan-me's version (package.json; bundled into lib/ at build time). */
export const VERSION: string = pkg.version;

/** Where to get a pinned plan-me (the release tarball; npm's global install from a git URL is unreliable). */
export function installHint(range: string): string {
  const exact = minVersion(range)?.version;
  const tag = exact ? `v${exact}` : "vX.Y.Z";
  return `npm install -g https://github.com/dev-build-deploy/plan-me/archive/refs/tags/${tag}.tar.gz`;
}

/**
 * The warning for a configuration that asks for another plan-me (its `version`, a semver range), or nothing.
 * @param wanted The configured range (`>=0.3.0`, `^0.3`, `0.3.1`); nothing to check when undefined
 * @param current The running version (default: this plan-me's)
 * @returns One line for stderr, or undefined when the version satisfies the range
 */
export function versionWarning(wanted: string | undefined, current: string = VERSION): string | undefined {
  if (wanted === undefined || wanted.trim() === "") return undefined;
  if (validRange(wanted) === null) return `warning: .plan-me.json "version" is not a semver range: "${wanted}"`;
  if (satisfies(current, wanted)) return undefined;
  const why = ltr(current, wanted) ? "older than" : "outside";
  return `warning: plan-me ${current} is ${why} the version this repository asks for (${wanted}): ${installHint(wanted)}`;
}

/**
 * The version warning for a configuration file, when it exists and asks for a version. A file that can't be read or
 * parsed gives no warning here (loading it reports that).
 * @param file The configuration file
 */
export function configVersionWarning(file: string, current: string = VERSION): string | undefined {
  try {
    if (!fs.existsSync(file)) return undefined;
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { version?: unknown };
    return typeof raw.version === "string" ? versionWarning(raw.version, current) : undefined;
  } catch (_e) {
    return undefined;
  }
}
