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
| `new` | title, body, type, priority, component, role, size, parent, blockedBy, design, id; the body must pass the issue check (refused with the findings otherwise; prose warnings come first in the answer) | yes |
| `check_issue` | body, type, title: the [issue check](./cli.md#the-issue-check), a tool error on errors | no |
| `start` | ref, branch | yes |
| `block` | ref, by | yes |
| `ask` | ref (an issue, or a new question's title), question | yes |
| `decide` | text, title, by, summary, scope, question (the issue it answers), supersedes, amends, date, id; `ref` only for the deprecated asking form (answers with a warning first) | yes |
| `decisions_index` | (none) | yes |
| `decisions_check` | (none) | no |
| `decisions_import` | file, format, by, scope, dryRun | yes |
| `templates` | force, dryRun | yes |
| `templates_check` | (none) | no |
| `done` | ref, note | yes |

`ref` is a number, `#n` or a marker id. Every tool also takes `json: true` to answer with the JSON the CLI's `--json`
prints; by default it answers with the compact text (one line per item). Read-only tools carry `readOnlyHint`, all
carry `idempotentHint`. Errors come back as a tool error (`isError`) with one line of text; a failing
`decisions_check`, `templates_check` and `check_issue` too, with one line per problem. A `new` whose body fails the
issue check answers `error: the issue was not created: ...` with the errors and the type's sections. The decision and template tools work on the
files under the server's working directory ([decisions.md](./decisions.md)); the template tools need the
configuration but no token.

## Configuration

The server uses the same configuration and token as the CLI (`.plan-me.json` in its working directory, or
`--config`; `GITHUB_TOKEN`, `GH_TOKEN` or `gh auth token`).

**Claude Code**: the plan-me Claude Code plugin, which every repository using plan-me enables
(`plan-me claude install`; see the [README](../README.md#claude-code-plugin)), declares this server: it runs the
plugin's bundled CLI (`node <plugin>/bundle/index.js mcp`), so neither an `.mcp.json` nor a global install is needed.
Started in a subfolder, the server works from the nearest folder upwards holding `.plan-me.json`. Without a token
(`GITHUB_TOKEN`, `GH_TOKEN` or `gh auth token`) the backlog tools answer with an error and the decision tools still
work.

Any other MCP client: run `plan-me --config /path/to/.plan-me.json mcp` as a stdio server.
