// SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
// SPDX-License-Identifier: CC0-1.0

// Copies the shipped Vale configuration (vale/) next to a bundle, as pull-me's scripts/copy-vale.mjs does. The Claude
// plugin is installed from its own folder (claude-plugin/), so its bundle cannot reach the repository's vale/ folder.
// Usage: node scripts/copy-vale.mjs <dir>

import { cpSync, rmSync } from "node:fs";

const target = process.argv[2];
if (!target) {
  console.error("usage: node scripts/copy-vale.mjs <dir>");
  process.exit(2);
}
rmSync(target, { recursive: true, force: true });
cpSync("vale", target, { recursive: true });
