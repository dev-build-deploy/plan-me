<!--
SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
SPDX-License-Identifier: MIT
-->

# Command Line Interface

## Installation instructions

A pre-compiled version of the CLI is part of this repository:

```sh
$ npm install -g https://github.com/dev-build-deploy/plan-me
$ plan-me --help
```

## Global options

| Option | Meaning |
| --- | --- |
| `-c, --config <file>` | The configuration file (default `.plan-me.json`, see [config.md](./config.md)) |
| `-r, --repo <owner/name>` | Overrides the configured repository |
| `--json` | JSON instead of compact text, for every command |

An item reference (`<ref>`) is `12`, `#12`, or the id from an item's hidden marker (`<!-- plan-me:id=walk-rocks -->`,
set by `new --id` and `import`).

## Commands

| Command | What it does |
| --- | --- |
| `init [--dry-run]` | Creates the missing boards (one per component, linked to the repository), fields, options and labels. Existing options are kept. Prints one line per action, or `up to date`. |
| `new <title> [--body t] [--type T] [--priority P] [--component c] [--role r] [--size s] [--parent ref] [--blocked-by ref]... [--design path]... [--id id]` | Creates an item: labels, issue type, board fields, sub-issue of its epic, dependencies (status blocked while a blocker is open), design doc links in the body. With `--id` it is idempotent. |
| `start <ref> [--branch b]` | Status in-progress; the branch as a `Branch: b` line in the body. |
| `block <ref> --by <ref>` | A "blocked by" dependency; status blocked while the blocker is open. |
| `decide <ref> [--question t]` | Status needs-decision; the question as a comment. |
| `done <ref> [--note t]` | A **Done.** comment with the note, closed (completed), status done. |
| `next [filters] [--limit n]` | The next item(s): open, unblocked, not an epic; P1 before P2 before P3; within a priority in-progress, then needs-decision, then open; then by number. |
| `list [filters] [--state open\|closed\|all]` | The matching items in the same order. |
| `show <ref>` | One item: its line, URL and body. |
| `snapshot [--out file]` | The open backlog, one line per item, per component, epics with their children indented. |
| `import <path> [--format folder\|lines] [--component c] [--design-prefix p] [--done skip\|closed] [--dry-run]` | See below. |
| `mcp` | Runs the MCP server on stdio ([mcp.md](./mcp.md)). |

Filters: `--component c`, `--role r`, `--status s`, `--priority P`, `--type T`, `--parent n`.

Mutating commands print what changed and the item afterwards:

```sh
$ plan-me start 12 --branch feat/12-lab
#12 branch feat/12-lab; status open -> in-progress
#12 [leertoren P1 in-progress feel-polish] Controller feel lab
$ plan-me start 12 --branch feat/12-lab
#12 unchanged
#12 [leertoren P1 in-progress feel-polish] Controller feel lab
```

## Import

`import` is for moving an existing markdown backlog onto GitHub, once, and can be rerun safely: each issue carries a
hidden `<!-- plan-me:id=<id> -->` marker, existing ids are skipped, and parents and dependencies are resolved after
all items exist. `--dry-run` prints the plan.

**(a) A folder of item files** (`import docs/backlog`): each `.md` file with front matter

```yaml
id: walk-rocks          # the marker id (files without one are skipped)
type: feature           # epic, feature, bug, design, decision -> that type; others (chore, art) -> Task
parent: epic-walk       # the epic's id -> sub-issue
title: "..."
status: open            # open | in-progress | needs-decision | blocked | done
priority: P1
area: engine, story     # the first area naming a board is the component (else --component)
owner: helper           # a line in the body; the role when agent is empty
agent: feature-dev      # the role
decisions: "16, 17"     # a "Decisions:" line in the body
design: [design/x.md]   # links in the body (prefixed with --design-prefix, default docs/)
depends_on: [other-id]  # blocked by
```

**(b) A line list** (`import backlog.md`): `## P1` headings set the priority; `- **id** · text. Helper: role.` starts
an item (indented lines continue it), its title is the first sentence; text starting "In progress" is in-progress;
`- ~~id~~ done ...` lines are done items.

Done items are skipped by default; `--done closed` imports them as closed issues.
