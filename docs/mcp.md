<!--
SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
SPDX-License-Identifier: MIT
-->

# MCP server

`plan-me mcp` runs a [Model Context Protocol](https://modelcontextprotocol.io) server on stdio (the official
TypeScript SDK). It exposes the CLI's commands as tools, with the same behaviour: deterministic, idempotent, compact.

| Tool | Input | Mutates |
| --- | --- | --- |
| `next` | component, role, status, priority, type, parent, limit | no |
| `list` | component, role, status, priority, type, parent, state | no |
| `show` | ref | no |
| `snapshot` | (none) | no |
| `new` | title, body, type, priority, component, role, size, parent, blockedBy, design, id | yes |
| `start` | ref, branch | yes |
| `block` | ref, by | yes |
| `decide` | ref, question | yes |
| `done` | ref, note | yes |

`ref` is a number, `#n` or a marker id. Every tool also takes `json: true` to answer with the JSON the CLI's `--json`
prints; by default it answers with the compact text (one line per item). Read-only tools carry `readOnlyHint`, all
carry `idempotentHint`. Errors come back as a tool error (`isError`) with one line of text.

## Configuration

The server uses the same configuration and token as the CLI (`.plan-me.json` in its working directory, or
`--config`; `GITHUB_TOKEN`, `GH_TOKEN` or `gh auth token`).

Claude Code (`.mcp.json` in the managed repository):

```json
{
  "mcpServers": {
    "plan-me": { "command": "plan-me", "args": ["mcp"] }
  }
}
```

Any other MCP client: run `plan-me --config /path/to/.plan-me.json mcp` as a stdio server.
