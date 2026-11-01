// SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import { incrementOf, nextVersion } from "./version-check.mjs";

test("increments follow release-me's semver defaults", () => {
  assert.equal(incrementOf("feat(cli): sync on change"), "minor");
  assert.equal(incrementOf("fix: keep the lock"), "patch");
  assert.equal(incrementOf("feat!: drop the v1 config"), "major");
  assert.equal(incrementOf("fix(api): x\n\nBREAKING CHANGE: the id format changed"), "major");
  assert.equal(incrementOf("docs: notes-app ids"), undefined);
  assert.equal(incrementOf("Merge branch 'main'"), undefined);
});

test("the largest increment wins; none keeps the version", () => {
  assert.equal(nextVersion("v0.5.0", ["fix: a", "feat: b", "docs: c"]), "0.6.0");
  assert.equal(nextVersion("v0.5.0", ["fix: a"]), "0.5.1");
  assert.equal(nextVersion("v0.5.0", ["feat!: a", "fix: b"]), "1.0.0");
  assert.equal(nextVersion("v0.5.0", ["docs: a", "ci: b"]), "0.5.0");
});
