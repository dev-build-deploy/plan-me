<!--
SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
SPDX-License-Identifier: MIT
-->

# Command Line Interface

## Installation instructions

A pre-compiled version of the CLI is part of this repository. Install a release, pinned to its tag, so everyone
working on a repository (people, CI, agents in worktrees) runs the same plan-me:

```sh
$ npm install -g https://github.com/dev-build-deploy/plan-me/archive/refs/tags/v0.3.0.tar.gz
$ plan-me --version
0.3.0
```

Use the release's tarball for a global install: npm's global install from a git URL
(`npm install -g github:dev-build-deploy/plan-me#v0.3.0`) can leave a link to a deleted temporary clone. As a
project dependency the git URL works (`npm install -D github:dev-build-deploy/plan-me#v0.3.0`, then
`npx plan-me ...`). The default branch (`npm install -g https://github.com/dev-build-deploy/plan-me`) is the
newest, unreleased state.

`plan-me --version` prints the version (`--json --version`: `{"version": "0.3.0"}`), for hooks and setup scripts
that compare it to the version a repository wants. A repository can name that version in its configuration
(`"version": ">=0.3.0"`, see [config.md](./config.md)); every command then warns on stderr when the installed
plan-me does not satisfy it, with the install command for the wanted release.

## Global options

| Option | Meaning |
| --- | --- |
| `-c, --config <file>` | The configuration file (default `.plan-me.json`, see [config.md](./config.md)) |
| `-r, --repo <owner/name>` | Overrides the configured repository |
| `--json` | JSON instead of compact text, for every command |
| `-V, --version` | Prints the version (with `--json` as `{"version": ...}`) |

The decision commands (`decide`, `decisions ...`) and `claude ...` work on the files under the current directory and
need no configuration or token, except `decide --question`. `templates` and `templates check` need the configuration; a
token only to look up the organization's issue types (below).

An item reference (`<ref>`) is `12`, `#12`, or the id from an item's hidden marker (`<!-- plan-me:id=walk-rocks -->`,
set by `new --id` and `import`).

## Commands

| Command | What it does |
| --- | --- |
| `init [--dry-run]` | Creates the missing boards (one per component, linked to the repository), fields, options and labels, enables the Claude Code plugin (`claude install`) and writes the issue forms (`templates`). Existing options are kept. Prints one line per action, or `up to date`. |
| `templates [--force] [--dry-run]` | Writes the issue forms: `.github/ISSUE_TEMPLATE/<type>.yml` per configured type and `config.yml` (see below). Unchanged files are left alone (`up to date`); a form edited by hand is left alone unless `--force`; a generated form for a type no longer configured is removed. |
| `templates check` | One line per problem and exit code 1: a generated form missing, stale or for a type no longer configured. Forms edited by hand pass; a repository without plan-me's forms passes. |
| `new <title> [--body t] [--type T] [--priority P] [--component c] [--role r] [--size s] [--parent ref] [--blocked-by ref]... [--design path]... [--id id]` | Creates an item: labels, issue type, board fields, sub-issue of its epic, dependencies (status blocked while a blocker is open), design doc links in the body. With `--id` it is idempotent. |
| `start <ref> [--branch b]` | Status in-progress; the branch as a `Branch: b` line in the body. |
| `block <ref> --by <ref>` | A "blocked by" dependency; status blocked while the blocker is open. |
| `ask <ref\|title> [question]` | Opens a question: an issue (`12`, `#12`, an id) becomes needs-decision with the question as a comment; any other text is a new question issue's title (needs-decision, the question as its body; idempotent). |
| `decide <text> --title t --by b [--summary s] [--scope a]... [--question ref] [--supersedes id] [--amends id] [--date d] [--id id]` | Records a decision: writes `docs/decisions/<date>-<id>.md` and regenerates `docs/decisions.md`; with `--question` (an issue), that issue gets the answer, the file's path and status in-progress. See [decisions.md](./decisions.md). The old `decide <ref> [--question "<text>"]` (no `--title`) still asks, with a deprecation warning. |
| `decisions index` | Regenerates `docs/decisions.md` from `docs/decisions/`. |
| `decisions check` | One line per problem and exit code 1: invalid front matter, colliding ids or numbers, a dangling `superseded_by`, a stale or hand-edited index. |
| `decisions install [--command c]` | Sets up the merge driver for `docs/decisions.md`: a `.gitattributes` line and this clone's git config. Once per clone. |
| `decisions merge-driver <base> <ours> <theirs>` | Git's merge driver (git runs it): merges the decisions both indexes list and writes the index again. |
| `decisions import <file> --format numbered\|labelled [--by b] [--scope a]... [--dry-run]` | Converts an old numbered list into decision files, keeping the numbers; rerunnable. |
| `done <ref> [--note t]` | A **Done.** comment with the note, closed (completed), status done. |
| `next [filters] [--limit n]` | The next item(s): open, unblocked, not an epic; P1 before P2 before P3; within a priority in-progress, then needs-decision, then open; then by number. |
| `list [filters] [--state open\|closed\|all]` | The matching items in the same order. |
| `show <ref>` | One item: its line, URL and body. |
| `snapshot [--out file]` | The open backlog, one line per item, per component, epics with their children indented. |
| `import <path> [--format folder\|lines] [--component c] [--design-prefix p] [--done skip\|closed] [--dry-run]` | See below. |
| `claude install [--dry-run]` | Enables the plan-me Claude Code plugin in `.claude/settings.json`: `enabledPlugins["plan-me@dev-build-deploy"]` and the `dev-build-deploy` marketplace, merged into the file (everything else kept). Idempotent (`up to date`). No token needed. |
| `claude check` | One line per problem and exit code 1 when a repository with the configuration file does not enable the plugin; `ok` otherwise. Every repository using plan-me uses the plugin: there is no opt-out. |
| `mcp` | Runs the MCP server on stdio ([mcp.md](./mcp.md)); from a subfolder it works from the nearest folder upwards holding the configuration file. |

Filters: `--component c`, `--role r`, `--status s`, `--priority P`, `--type T`, `--parent n`.

Mutating commands print what changed and the item afterwards:

```sh
$ plan-me start 12 --branch feat/12-lab
#12 branch feat/12-lab; status open -> in-progress
#12 [web P1 in-progress frontend] Editor toolbar prototype
$ plan-me start 12 --branch feat/12-lab
#12 unchanged
#12 [web P1 in-progress frontend] Editor toolbar prototype
```

## Issue templates

`plan-me templates` (and `init`) writes GitHub [issue forms](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms)
into `.github/ISSUE_TEMPLATE/`, so an issue opened in the GitHub UI has the same structure and fields as one made with
`new`:

| Type | Sections (`### <heading>` in the issue body) |
| --- | --- |
| Feature | Goal, Acceptance criteria, Design docs |
| Bug | Steps to reproduce, Expected, Actual, Version, Evidence |
| Task | What to do, Done when |
| Design | Problem, Constraints, Options, Design docs |
| Decision | Question, Options, Who decides, Context (opens as needs-decision; answered with `decide --question`) |
| Epic | Outcome, Child items, Design docs |
| any other type | Description |

Every form then has a **Component** dropdown (the `boards`, default `defaultComponent`; only with more than one
board) and the **Priority**, **Role** and **Size** fields (their configured names and options: dropdowns, or a text
input for a role without options). The Action copies these answers to the labels and board fields when the issue is
opened ([github-action.md](./github-action.md)).

- **The type**: a form sets the organization's issue type (`type:`) when it has one of that name, else it adds the
  `type:<name>` label (which `init` creates). The issue types are looked up with the token; without one, each existing
  form keeps what it has and new forms use the label.
- **The board**: with a single board whose `number` is configured, the form adds the issue to it (`projects:`);
  otherwise the Action puts it on the chosen component's board.
- **`config.yml`**: blank issues off by default and the contact links (`templates` in [config.md](./config.md)).
- **Hand edits**: each file carries a `# plan-me:sha256=...` line, the hash of the rest of the file. A file whose hash
  no longer matches was edited by hand, and a file without the line was not written by plan-me: both are left alone
  (reported, not changed) unless `--force`.
- **Licence headers**: with a `.reuse-me.json`, each file starts with the SPDX header (as `#` comments) of its matching
  rule; a rewritten file keeps its year.
- **CI**: `templates check` (also the `plan-me-templates` pre-commit hook and every Action run).

```sh
$ plan-me templates
write .github/ISSUE_TEMPLATE/feature.yml
write .github/ISSUE_TEMPLATE/bug.yml
...
$ plan-me templates
.github/ISSUE_TEMPLATE up to date
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
an item (indented lines continue it), its title is the first sentence. After the id may come joined ids
(`**id** + **other-id**`: the first id is the item), a `(meta)` group (dates, branches; brackets may nest; it stays
in the body, not the title) and a `·`, `-` or `:` separator. A leading priority option (`P3 · text`,
`P3 (found by a test bot): text`) overrides the heading's priority and is left out of the title. A leading status phrase sets the status and is left out
of the title (which comes from the next sentence): "In progress" -> in-progress, "Needs a decision" or "Needs
decision" -> needs-decision, "Blocked" or "Blocked by <id>" -> blocked. `- ~~id~~ done ...` lines are done items, and
so is every item under a `## Done` heading (up to the next `## P*`).

Dependencies in a line list are the ids **defined in the same file** named in a leading `After <id>[, <id>]:` clause
(a `(...)` group may come before the colon; the clause is left out of the title) or after "Blocked by" / "Depends on"
(`a, b` or `a and b`). An unknown name there that looks like an id (`export-html`) is a `warn` line in the plan, not a
dependency; a plain word ("Depends on the new API") is ignored. "After <id>" anywhere else in the text (`... After
export-csv.`) counts only for known ids, without warnings ("after" is a common word).

Done items are skipped by default; `--done closed` imports them as closed issues.
