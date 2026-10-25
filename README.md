<!--
SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
SPDX-License-Identifier: MIT
-->

# PlanMe

PlanMe manages a backlog on GitHub Issues and Projects v2: a [Command Line Interface](./docs/cli.md), a
[GitHub Action](./docs/github-action.md) for the automation, and an [MCP server](./docs/mcp.md) exposing the same
commands as tools. It is deterministic (no AI anywhere) and built to be cheap for an LLM to drive: one line per item
by default, `--json` everywhere, idempotent commands, and a local snapshot to grep instead of many API calls.

- **One board per component**: each component (e.g. `engine`, `birchling`, `leertoren`) has its own Projects v2
  board; an issue's `component:<name>` label picks it.
- **Fields**: Status (open, in-progress, needs-decision, blocked, done), Priority (P1-P3), Role (the agent role that
  does it), Size.
- **Issue types, epics and dependencies**: the organization's issue types (labels for the types it lacks), epics with
  sub-issues, "blocked by" dependencies.
- **Pick-up order**: `plan-me next` gives the open, unblocked item: P1 before P2 before P3; within a priority
  in-progress and needs-decision first.
- **Import**: a folder of markdown item files with front matter, or a markdown line list; rerunnable.

```sh
$ plan-me snapshot
# plan-me snapshot dev-build-deploy/birchling: 4 open items
## leertoren
#12 [leertoren P1 in-progress feel-polish] Controller feel lab
#3 [leertoren P1 open epic] Hero controller
  #14 [leertoren P1 open engine-dev] Engine motor bound to Lua — blocked by #12
#20 [leertoren P2 open user] Top-down walk for the youngest
```

## Native GitHub features and fallbacks

PlanMe detects per run (one introspection query) what the repository supports:

| Feature | Native (used when present) | Fallback |
| --- | --- | --- |
| Epics | sub-issues (`addSubIssue`, `parent`, `subIssues`) | `Parent: #n` line in the child, `- [ ] #n` task list in the epic |
| Dependencies | issue dependencies (`addBlockedBy`, `blockedBy`, `blocking`) | `Blocked by #n` line in the body |
| Types | the organization's issue types (`type` on create, `issueType`) | a `type:<name>` label |

On github.com (October 2026) all three are native; the fallbacks are for GitHub Enterprise Server versions without
them. Types the organization doesn't define (e.g. Design, Decision, Epic when it only has Task/Bug/Feature) always use
the label.

## Using plan-me from an LLM

- **Read once, grep often**: `plan-me snapshot --out backlog.txt` writes the whole open backlog, one line per item
  (`#12 [component priority status role] title — blocked by #9`), epics with their children indented. It is
  deterministic (no timestamps), so it diffs cleanly; grep it instead of calling the API per item.
- **Ask for the next job**: `plan-me next --component leertoren --role feature-dev` returns one line.
- **Structured output**: add `--json` to any command; mutating commands answer `{item, changed, actions}`.
- **Idempotent**: every command can be retried; a second run reports `#12 unchanged`. `new --id <id>` returns the
  existing item instead of creating a duplicate.
- **MCP**: `plan-me mcp` serves next, list, show, snapshot, new, start, block, decide and done as tools with JSON
  schemas; each answers in the compact text unless called with `json: true`. See [docs/mcp.md](./docs/mcp.md).

## Configuration

See [docs/config.md](./docs/config.md) for `.plan-me.json`.

## Contributing

If you have suggestions for how plan-me could be improved, or want to report a bug, open an issue! We'd love all and
any contributions.

For more, check out the [Contributing Guide](CONTRIBUTING.md).

## License

- [MIT](./LICENSES/MIT.txt) © 2026 Kevin de Jong \<monkaii@hotmail.com\>
