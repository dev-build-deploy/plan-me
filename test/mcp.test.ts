/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

// eslint-disable-next-line import/no-unresolved -- resolved through the package exports map
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
// eslint-disable-next-line import/no-unresolved -- resolved through the package exports map
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createMcpServer } from "../src/mcp.js";

import { setup } from "./fake.js";

describe("MCP server", () => {
  test("exposes the commands as tools and runs them", async () => {
    const { backlog } = setup();
    const server = createMcpServer(() => backlog);
    const client = new Client({ name: "test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);

    const { tools } = await client.listTools();
    expect(tools.map(t => t.name).sort()).toEqual(
      ["block", "decide", "done", "list", "new", "next", "show", "snapshot", "start"].sort()
    );
    const next = tools.find(t => t.name === "next");
    expect(next?.inputSchema.properties).toHaveProperty("component");
    expect(next?.annotations?.readOnlyHint).toBe(true);

    const created = await client.callTool({ name: "new", arguments: { title: "From MCP", priority: "P1" } });
    expect((created.content as { text: string }[])[0].text).toBe(
      "#1 created #1; status - -> open; priority - -> P1\n#1 [game P1 open] From MCP"
    );
    const json = await client.callTool({ name: "next", arguments: { json: true } });
    expect(JSON.parse((json.content as { text: string }[])[0].text)[0]).toMatchObject({ number: 1, priority: "P1" });
    const bad = await client.callTool({ name: "show", arguments: { ref: "nope" } });
    expect(bad.isError).toBe(true);
    await client.close();
  });
});
