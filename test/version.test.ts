/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import path from "path";

import { resolveConfig } from "../src/config";
import { configVersionWarning, installHint, VERSION, versionWarning } from "../src/version";

import { repo } from "./repo";

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));

describe("version", () => {
  test("is package.json's", () => {
    expect(VERSION).toBe(pkg.version);
  });

  test("a satisfied range, or none, gives no warning", () => {
    expect(versionWarning(undefined, "0.3.0")).toBeUndefined();
    expect(versionWarning("", "0.3.0")).toBeUndefined();
    expect(versionWarning(">=0.3.0", "0.3.0")).toBeUndefined();
    expect(versionWarning("^0.3.0", "0.3.4")).toBeUndefined();
  });

  test("an older plan-me is told how to install the wanted one", () => {
    expect(versionWarning(">=0.4.0", "0.3.0")).toBe(
      "warning: plan-me 0.3.0 is older than the version this repository asks for (>=0.4.0): " +
        "npm install -g https://github.com/dev-build-deploy/plan-me/archive/refs/tags/v0.4.0.tar.gz"
    );
    expect(versionWarning("~0.3.0", "0.4.0")).toMatch(/^warning: plan-me 0\.4\.0 is outside /);
    expect(versionWarning("not a range", "0.3.0")).toBe(
      'warning: .plan-me.json "version" is not a semver range: "not a range"'
    );
    expect(installHint("^1.2")).toMatch(/v1\.2\.0\.tar\.gz$/);
  });

  test("from the configuration file", () => {
    const root = repo({ ".plan-me.json": JSON.stringify({ repository: "octo-org/notes", version: ">=99.0.0" }) });
    expect(configVersionWarning(path.join(root, ".plan-me.json"))).toMatch(/is older than/);
    expect(configVersionWarning(path.join(root, "missing.json"))).toBeUndefined();
    expect(resolveConfig({ repository: "octo-org/notes", version: "^0.3" }).version).toBe("^0.3");
  });
});

describe("the CLI (the bundled lib/cli)", () => {
  const cli = path.join(__dirname, "..", "bin", "plan-me");
  const run = (root: string, args: string[]): { stdout: string; stderr: string } => {
    const r = spawnSync("node", [cli, ...args], { cwd: root, encoding: "utf8" });
    return { stdout: r.stdout, stderr: r.stderr };
  };

  test("--version, also as JSON", () => {
    const root = repo({});
    expect(execFileSync("node", [cli, "--version"], { cwd: root, encoding: "utf8" })).toBe(`${pkg.version}\n`);
    expect(JSON.parse(run(root, ["--json", "--version"]).stdout)).toEqual({ version: pkg.version });
  });

  test("warns on stderr when the configuration asks for a newer plan-me", () => {
    const root = repo({ ".plan-me.json": JSON.stringify({ repository: "octo-org/notes", version: ">=99.0.0" }) });
    const out = run(root, ["decisions", "check"]);
    expect(out.stderr).toMatch(
      /^warning: plan-me \S+ is older than the version this repository asks for \(>=99\.0\.0\)/
    );
    expect(out.stdout).toBe("docs/decisions: ok\n");
    const ok = repo({ ".plan-me.json": JSON.stringify({ repository: "octo-org/notes", version: `>=${pkg.version}` }) });
    expect(run(ok, ["decisions", "check"]).stderr).toBe("");
  });
});
