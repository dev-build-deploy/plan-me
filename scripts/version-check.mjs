// SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
// SPDX-License-Identifier: MIT

// The version a pull request will release, and whether package.json, package-lock.json and the Claude Code plugin's
// plugin.json carry it. release-me tags every push to main from the Conventional Commits since the latest release, but
// writes no files, so the files must carry the version before the merge. This mirrors release-me's semver defaults
// (a breaking change: major; feat: minor; fix: patch; anything else: no release) until release-me can dry-run on a
// pull request (it only accepts the default branch or release/*).
// Usage: node scripts/version-check.mjs           check (exit 1 with the fix when a file is off)
//        node scripts/version-check.mjs --write   write the expected version into the files

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const FILES = ["package.json", "package-lock.json", "claude-plugin/.claude-plugin/plugin.json"];
const SUBJECT = /^(\w+)(?:\([^)]*\))?(!)?: \S/;

/** The increment one commit asks for: "major", "minor", "patch" or undefined (not a Conventional Commit, or none). */
export function incrementOf(message) {
  const [subject = "", ...rest] = message.split("\n");
  const m = SUBJECT.exec(subject);
  if (!m) return undefined;
  if (m[2] || /^BREAKING[ -]CHANGE: /m.test(rest.join("\n"))) return "major";
  return { feat: "minor", fix: "patch" }[m[1]];
}

/** The version after the commits since `latest` ("v0.5.0" or "0.5.0"): the largest increment wins. */
export function nextVersion(latest, messages) {
  const [major, minor, patch] = latest.replace(/^v/, "").split(".").map(Number);
  const incs = new Set(messages.map(incrementOf));
  if (incs.has("major")) return `${major + 1}.0.0`;
  if (incs.has("minor")) return `${major}.${minor + 1}.0`;
  if (incs.has("patch")) return `${major}.${minor}.${patch + 1}`;
  return `${major}.${minor}.${patch}`;
}

const git = args => execFileSync("git", args, { encoding: "utf8" }).trim();

function expected() {
  const latest = git(["tag", "--list", "v[0-9]*", "--sort=-v:refname"]).split("\n")[0];
  if (!latest) return { latest: "none", version: "0.1.0", count: 0 };
  const log = git(["log", "--no-merges", "--format=%B%x00", `${latest}..HEAD`]);
  const messages = log.split("\0").map(m => m.trim()).filter(Boolean);
  return { latest, version: nextVersion(latest, messages), count: messages.length };
}

function versionIn(file) {
  return JSON.parse(readFileSync(file, "utf8")).version;
}

/** Replaces only the version strings (the root's, and package-lock's packages[""]), keeping the file's formatting. */
function writeVersion(file, version) {
  const times = file === "package-lock.json" ? 2 : 1;
  let text = readFileSync(file, "utf8");
  for (let i = 0; i < times; i++) text = text.replace(/("version": ")(?!\u0000)[^"]*(")/, (_, a, b) => `${a}\u0000${version}${b}`);
  writeFileSync(file, text.replace(/\u0000/g, ""));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { latest, version, count } = expected();
  const off = FILES.filter(f => {
    const json = JSON.parse(readFileSync(f, "utf8"));
    return json.version !== version || (f === "package-lock.json" && json.packages?.[""]?.version !== version);
  });
  if (process.argv.includes("--write")) {
    off.forEach(f => writeVersion(f, version));
    console.log(off.length ? `version ${version}: wrote ${off.join(", ")}` : `version ${version}: up to date`);
  } else if (off.length) {
    console.log(`version: after ${latest} and ${count} commit(s), the next release is ${version}, but ${off.map(f => `${f} says ${versionIn(f)}`).join(", ")}.`);
    console.log(`Fix: node scripts/version-check.mjs --write, then commit the files (release-me tags ${version} on merge).`);
    process.exit(1);
  } else {
    console.log(`version ${version}: ok (${count} commit(s) since ${latest})`);
  }
}
