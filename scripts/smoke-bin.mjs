// SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
// SPDX-License-Identifier: CC0-1.0

// Runs the committed bundles the way users do: `bin/plan-me --help`, a command that fails on its configuration
// (exit 1), and `bin/plan-me mcp` (stdio MCP server: initialize, then list the tools). Catches a bundle or bin
// wrapper that no longer loads (e.g. CommonJS `require` of an ESM bundle). Usage: node scripts/smoke-bin.mjs

import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";

const bin = resolve("bin/plan-me");

const cases = [
  { args: ["--help"], exit: 0, output: /Deterministic GitHub backlog management/ },
  { args: ["next"], exit: 1, output: /"repository" must be "owner\/name"/ },
];

let failed = false;
const report = (ok, label, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) {
    failed = true;
    if (detail) console.error(detail.trim());
  }
};

for (const c of cases) {
  const run = spawnSync(process.execPath, [bin, ...c.args], { encoding: "utf8", cwd: process.env.TMPDIR || "/tmp" });
  const out = `${run.stdout}${run.stderr}`;
  report(run.status === c.exit && c.output.test(out), `bin/plan-me ${c.args.join(" ")} (exit ${run.status}, expected ${c.exit})`, out);
}

// The MCP server: newline-delimited JSON-RPC on stdin/stdout.
await new Promise(done => {
  const child = spawn(process.execPath, [bin, "mcp"], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  let err = "";
  const timer = setTimeout(() => child.kill(), 15000);
  child.stdout.on("data", d => (out += d));
  child.stderr.on("data", d => (err += d));
  child.on("close", () => {
    clearTimeout(timer);
    const replies = out.split("\n").filter(Boolean).map(l => JSON.parse(l));
    const tools = replies.find(r => r.id === 2)?.result?.tools?.map(t => t.name) ?? [];
    report(tools.includes("next") && tools.includes("new"), `bin/plan-me mcp lists its tools (${tools.length}: ${tools.join(", ")})`, err || out);
    done();
  });
  const send = m => child.stdin.write(`${JSON.stringify(m)}\n`);
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  setTimeout(() => child.stdin.end(), 1500);
});

process.exit(failed ? 1 : 0);
