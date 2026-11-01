<!--
SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
SPDX-License-Identifier: MIT
-->

# PlanMe

PlanMe manages a backlog on GitHub Issues and Projects v2: a [Command Line Interface](./docs/cli.md), a
[GitHub Action](./docs/github-action.md) for the automation, and an [MCP server](./docs/mcp.md) exposing the same
commands as tools. It is deterministic (no AI anywhere) and built to be cheap for an LLM to drive: one line per item
by default, `--json` everywhere, idempotent commands, and a local snapshot to grep instead of many API calls.

- **One board per component**: each component (e.g. `api`, `web`, `mobile`) has its own Projects v2
  board; an issue's `component:<name>` label picks it.
- **Fields**: Status (open, in-progress, needs-decision, blocked, done), Priority (P1-P3), Role (the agent role that
  does it), Size.
- **Issue types, epics and dependencies**: the organization's issue types (labels for the types it lacks), epics with
  sub-issues, "blocked by" dependencies.
- **Pick-up order**: `plan-me next` gives the open, unblocked item: P1 before P2 before P3; within a priority
  in-progress and needs-decision first.
- **Import**: a folder of markdown item files with front matter, or a markdown line list; rerunnable.
- **Decisions**: one file per decision in `docs/decisions/`, a generated index in `docs/decisions.md`, a check for
  the Action and pre-commit; no configuration (below).

```sh
$ plan-me snapshot
# plan-me snapshot octo-org/notes: 4 open items
## web
#12 [web P1 in-progress frontend] Editor toolbar prototype
#3 [web P1 open epic] Rich-text editor
  #14 [web P1 open backend] Autosave endpoint — blocked by #12
#20 [web P2 open user] Larger text for small screens
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

## Installation

Pin a release, so everyone on a repository (people, CI, agents) runs the same plan-me:

```sh
npm install -g https://github.com/dev-build-deploy/plan-me/archive/refs/tags/v0.3.0.tar.gz
plan-me --version
```

A repository can ask for a version in `.plan-me.json` (`"version": ">=0.3.0"`); plan-me warns when it is older.
The Action is pinned with its tag (`uses: dev-build-deploy/plan-me@v0.3.0`). Details: [docs/cli.md](./docs/cli.md).

## Using plan-me from an LLM

- **Read once, grep often**: `plan-me snapshot --out backlog.txt` writes the whole open backlog, one line per item
  (`#12 [component priority status role] title — blocked by #9`), epics with their children indented. It is
  deterministic (no timestamps), so it diffs cleanly; grep it instead of calling the API per item.
- **Ask for the next job**: `plan-me next --component web --role frontend` returns one line.
- **Structured output**: add `--json` to any command; mutating commands answer `{item, changed, actions}`.
- **Idempotent**: every command can be retried; a second run reports `#12 unchanged`. `new --id <id>` returns the
  existing item instead of creating a duplicate.
- **Decisions**: grep `docs/decisions.md` (one line per decision); follow only the current and amended ones.
- **MCP**: `plan-me mcp` serves next, list, show, snapshot, new, start, block, decide, done and the decisions commands as tools with JSON
  schemas; each answers in the compact text unless called with `json: true`. See [docs/mcp.md](./docs/mcp.md).

## Decisions

Every repository using plan-me keeps its decisions the same way, with no configuration:

- **One file per decision**: `docs/decisions/<date>-<id>.md`, front matter (`id`, `number` only for imported old
  numbers such as `129` or `L99`, `date`, `by`, `status` current | amended | superseded, `superseded_by`, `scope`,
  `summary`, `question`) and the decision in full. New decisions get no number, so parallel branches never clash.
- **A generated index**: `docs/decisions.md`, one greppable line per decision, current first, then amended, then
  superseded (marked with what replaces them, so nobody follows them). Never edited by hand; deterministic, so it
  diffs cleanly.
- **Commands**: `plan-me ask <ref|title> "<question>"` opens a question (needs-decision);
  `plan-me decide "<text>" --title ... --by ... [--question 42] [--supersedes <id>]` records a decision;
  `plan-me decisions index` regenerates the index; `plan-me decisions check` fails on invalid files, colliding ids,
  a dangling `superseded_by` or a stale index (the Action and the `plan-me-decisions` pre-commit hook run it);
  `plan-me decisions import <file> --format numbered|labelled` converts an old numbered list, keeping its numbers.
- **Questions**: a needs-decision issue gets the answer and the file's path from `decide --question`; the pull
  request carrying the file closes it (`Closes #42`).
- **No index conflicts**: a git merge driver regenerates `docs/decisions.md` when branches are merged.
- **Licence headers**: with a `.reuse-me.json`, every decision file gets an SPDX header from its matching rule.

**Once per clone**, set up the merge driver (it adds a line to `.gitattributes`, which you commit once, and the driver
to the clone's git configuration, which git never shares):

```sh
plan-me decisions install
```

```sh
$ plan-me decide "Scripts are Lua." --title "Lua is the script language" --by "the user" --question 42
wrote docs/decisions/2026-11-01-lua-is-the-script-language.md
wrote docs/decisions.md
- lua-is-the-script-language · - · 2026-11-01 · current · - · Lua is the script language
#42 comment; decision docs/decisions/2026-11-01-lua-is-the-script-language.md; status needs-decision -> in-progress
#42 [game P2 in-progress] Which script language?
```

The guide: [docs/decisions.md](./docs/decisions.md).

## Configuration

See [docs/config.md](./docs/config.md) for `.plan-me.json`.

## Contributing

If you have suggestions for how plan-me could be improved, or want to report a bug, open an issue! We'd love all and
any contributions.

For more, check out the [Contributing Guide](CONTRIBUTING.md).

## License

- [MIT](./LICENSES/MIT.txt) © 2026 Kevin de Jong \<monkaii@hotmail.com\>
