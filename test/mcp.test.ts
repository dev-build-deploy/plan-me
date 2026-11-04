/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import fs from "fs";
import path from "path";

// eslint-disable-next-line import/no-unresolved -- resolved through the package exports map
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
// eslint-disable-next-line import/no-unresolved -- resolved through the package exports map
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createMcpServer } from "../src/mcp";

import { setup } from "./fake";
import { repo } from "./repo";

describe("MCP server", () => {
  test("exposes the commands as tools and runs them", async () => {
    const { backlog } = setup();
    const server = createMcpServer(() => backlog, process.cwd(), undefined, { vale: false });
    const client = new Client({ name: "test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);

    const { tools } = await client.listTools();
    expect(tools.map(t => t.name).sort()).toEqual(
      [
        "ask",
        "block",
        "check_issue",
        "decide",
        "decisions_check",
        "decisions_import",
        "decisions_index",
        "done",
        "list",
        "new",
        "next",
        "show",
        "snapshot",
        "start",
        "templates",
        "templates_check",
      ].sort()
    );
    const next = tools.find(t => t.name === "next");
    expect(next?.inputSchema.properties).toHaveProperty("component");
    expect(next?.annotations?.readOnlyHint).toBe(true);

    const refused = await client.callTool({ name: "new", arguments: { title: "From MCP", body: "notes" } });
    expect(refused.isError).toBe(true);
    expect((refused.content as { text: string }[])[0].text).toMatch(/^error: the issue was not created: 2 error/);
    expect(backlog.api).toBeDefined();
    const body =
      "### Why\n\nUsers ask.\n\n### Context\n\nThe app.\n\n### What\n\nAdd it.\n\n### Done when\n\n- [ ] Added.";
    const created = await client.callTool({
      name: "new",
      arguments: { title: "From MCP", priority: "high", type: "Task", body },
    });
    expect((created.content as { text: string }[])[0].text).toBe(
      "#1 created #1; status - -> open; priority - -> high\n#1 [game high open] From MCP"
    );
    const json = await client.callTool({ name: "next", arguments: { json: true } });
    expect(JSON.parse((json.content as { text: string }[])[0].text)[0]).toMatchObject({ number: 1, priority: "high" });
    const bad = await client.callTool({ name: "show", arguments: { ref: "nope" } });
    expect(bad.isError).toBe(true);
    const checked = await client.callTool({ name: "check_issue", arguments: { body, type: "Task", title: "x" } });
    expect((checked.content as { text: string }[])[0].text).toBe(
      "The issue passes every check.\nnote: the prose rules are off"
    );
    expect(tools.find(t => t.name === "decisions_check")?.annotations?.readOnlyHint).toBe(true);
    await client.close();
  });

  test("the decision tools work on the root's files; a failed check is a tool error", async () => {
    const { backlog } = setup();
    const root = repo();
    const server = createMcpServer(() => backlog, root);
    const client = new Client({ name: "test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const args = { text: "Files.", title: "Decisions as files", by: "the owner", date: "2026-11-01" };
    const decided = await client.callTool({ name: "decide", arguments: args });
    expect((decided.content as { text: string }[])[0].text).toContain("wrote docs/decisions.md");
    const ok = await client.callTool({ name: "decisions_check", arguments: {} });
    expect(ok.isError).toBeFalsy();
    fs.writeFileSync(path.join(root, "docs/decisions.md"), "edited by hand\n");
    const bad = await client.callTool({ name: "decisions_check", arguments: {} });
    expect(bad.isError).toBe(true);
    expect((bad.content as { text: string }[])[0].text).toMatch(/^docs\/decisions\.md: stale or edited by hand/);
    await client.close();
  });
});

describe("MCP templates tools", () => {
  test("templates writes the forms from the configuration, without a backlog", async () => {
    const root = repo();
    const { backlog } = setup();
    const server = createMcpServer(
      () => {
        throw new Error("no token");
      },
      root,
      () => backlog.config
    );
    const client = new Client({ name: "test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const written = await client.callTool({ name: "templates", arguments: {} });
    expect((written.content as { text: string }[])[0].text).toContain("write .github/ISSUE_TEMPLATE/bug.yml");
    const ok = await client.callTool({ name: "templates_check", arguments: {} });
    expect((ok.content as { text: string }[])[0].text).toBe(".github/ISSUE_TEMPLATE: ok");
    await client.close();
  });
});
