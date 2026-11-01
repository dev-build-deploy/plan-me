/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

// eslint-disable-next-line import/no-unresolved -- resolved through the package exports map
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// eslint-disable-next-line import/no-unresolved -- resolved through the package exports map
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { Backlog } from "./backlog";
import { CommandSpec, COMMANDS } from "./commands";
import { Config } from "./config";
import { VERSION } from "./version";

/** The server version reported to MCP clients. */
/** The MCP server reports the package version. */
export const MCP_VERSION = VERSION;

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

/**
 * Builds the MCP server with one tool per command. Each tool answers with the compact text by default, or the JSON
 * when called with `json: true`.
 * @param makeBacklog Returns the backlog to run against (a fresh one per call, so nothing is stale)
 * @param root The repository root holding the decision files and issue forms (default the working directory)
 * @param makeConfig Returns the configuration without a backlog (no token); default the backlog's
 */
export function createMcpServer(
  makeBacklog: () => Backlog,
  root: string = process.cwd(),
  makeConfig?: () => Config
): McpServer {
  const server = new McpServer({ name: "plan-me", version: MCP_VERSION });
  for (const [name, spec] of Object.entries(COMMANDS) as [string, CommandSpec<z.ZodRawShape>][]) {
    server.registerTool(
      name,
      {
        description: spec.description,
        inputSchema: { ...spec.input, json: z.boolean().optional().describe("Answer as JSON instead of text") },
        annotations: { readOnlyHint: !spec.mutates, idempotentHint: true },
      },
      async (args: Record<string, unknown>): Promise<ToolResult> => {
        try {
          const { json, ...rest } = args;
          const result = await spec.run({ backlog: makeBacklog, root, config: makeConfig }, rest);
          const out = json ? JSON.stringify(result.json) : result.text;
          const text = result.warning ? `${result.warning}\n${out}` : out;
          return { content: [{ type: "text", text }], ...(result.failed ? { isError: true } : {}) };
        } catch (e) {
          return { content: [{ type: "text", text: `error: ${(e as Error).message}` }], isError: true };
        }
      }
    );
  }
  return server;
}

/** Runs the MCP server on stdio until the client disconnects. */
export async function runMcpServer(makeBacklog: () => Backlog, makeConfig?: () => Config): Promise<void> {
  await createMcpServer(makeBacklog, process.cwd(), makeConfig).connect(new StdioServerTransport());
}
