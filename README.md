<!--
SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
SPDX-License-Identifier: MIT
-->

# PlanMe

PlanMe manages a backlog on GitHub Issues and Projects v2: a [Command Line Interface](./docs/cli.md), a
[GitHub Action](./docs/github-action.md) for the automation, an [MCP server](./docs/mcp.md) exposing the same
commands as tools, and a [Claude Code plugin](#claude-code-plugin) that every repository using plan-me enables. It is deterministic (no AI anywhere) and built to be cheap for an LLM to drive: one line per item
by default, `--json` everywhere, idempotent commands, and a local snapshot to grep instead of many API calls.

- **One board per component**: each component (e.g. `api`, `web`, `mobile`) has its own Projects v2
  board; an issue's `component:<name>` label picks it.
- **Fields**: Status (open, in-progress, needs-decision, blocked, done) and Role (the agent role that does it) on
  the board; Priority (urgent, high, medium, low) and Effort (high, medium, low) as the organization's
  [issue fields](./docs/config.md#issue-fields) (on the board for a repository owned by a user).
- **Issue types, epics and dependencies**: the organization's issue types (labels for the types it lacks), epics with
  sub-issues, "blocked by" dependencies.
- **Pick-up order**: `plan-me next` gives the open, unblocked item: urgent, then high, medium, low; within a priority
  in-progress and needs-decision first.
- **Import**: a folder of markdown item files with front matter, or a markdown line list; rerunnable; `--update`
  rewrites the issues of an earlier import in place.
- **Issues others can pick up**: every issue has a type and its sections (Why, Context, What, then the type's own),
  and its prose is checked with Vale and the organization's styles, as
  [pull-me](https://github.com/dev-build-deploy/pull-me) checks pull requests. `check-issue`, `new`, `import`, the
  Claude Code plugin and the Action all refuse an issue that fails ([the issue check](./docs/cli.md#the-issue-check)).
- **Decisions**: one file per decision in `docs/decisions/`, a generated index in `docs/decisions.md`, a check for
  the Action and pre-commit; no configuration (below).
- **Issue templates**: an issue form per type, with the same sections the issue check asks for (Bug: context, steps
  to reproduce, observed and expected behavior, additional context; Feature: context, problem, expected value,
  acceptance criteria; ...) and the component, Priority, Role and Effort, which the Action copies to the fields; no
  configuration (below).

```sh
$ plan-me snapshot
# plan-me snapshot octo-org/notes: 4 open items
## web
#12 [web high in-progress frontend] Editor toolbar prototype
#3 [web high open epic] Rich-text editor
  #14 [web high open backend] Autosave endpoint — blocked by #12
#20 [web medium open user] Larger text for small screens
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
- **MCP**: `plan-me mcp` serves next, list, show, snapshot, new, start, block, decide, done, the decisions and the templates commands as tools with JSON
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
#42 [game medium in-progress] Which script language?
```

The guide: [docs/decisions.md](./docs/decisions.md).

## Claude Code plugin

**Every repository that uses plan-me also uses the plan-me Claude Code plugin.** It is not optional: `plan-me init`
enables it, and `plan-me claude check` (run by the Action on every run, and by the `plan-me-claude` pre-commit hook)
fails a repository with a `.plan-me.json` whose `.claude/settings.json` does not.

```sh
plan-me claude install   # or `plan-me init`: merges into .claude/settings.json, keeping everything else
```

```json
{
  "enabledPlugins": { "plan-me@dev-build-deploy": true },
  "extraKnownMarketplaces": {
    "dev-build-deploy": { "source": { "source": "github", "repo": "dev-build-deploy/claude-plugins" } }
  }
}
```

Commit the file; Claude Code then offers to install the plugin from the
[dev-build-deploy marketplace](https://github.com/dev-build-deploy/claude-plugins) when the repository is trusted
(by hand: `/plugin install plan-me@dev-build-deploy`). The plugin (in [`claude-plugin/`](./claude-plugin)) brings:

- **The MCP server**: plan-me's commands as tools in every session ([docs/mcp.md](./docs/mcp.md)), run from the
  plugin's bundled CLI, so nothing else needs installing. Its token is `GITHUB_TOKEN`, `GH_TOKEN` or `gh auth token`;
  without one the decision tools still work.
- **Hooks**, only in a repository with `.plan-me.json`:
  - `gh issue create`, `gh issue edit` and `gh issue close` are denied with the plan-me command to use instead
    (`new`, `start`/`block`/`ask`, `done`): they bypass the board fields. `gh issue view`, `list` and `comment` pass.
    One aimed at another repository (`-R` / `--repo` naming a repository other than `.plan-me.json`'s) passes.
    With a body, the denial also lists what the issue check finds in it.
  - `plan-me new` and the MCP tool `new` run the bundled `plan-me check-issue` on the body first: errors deny always,
    warnings deny once per body (the same body sent again goes through), as pull-me's plugin does for pull requests.
  - A Write or Edit of the generated `docs/decisions.md`, or of an issue form plan-me generated (a
    `.github/ISSUE_TEMPLATE/*.yml` with a `# plan-me:sha256=` line), is denied.
  - `git commit` with changed decision files runs `plan-me decisions check` first and is denied on its problems.
  - The session starts with one note: `plan-me snapshot --out` to read the backlog, `plan-me next` for the next job.
- **The skill** `working-with-plan-me`: how an agent reads the backlog, starts work, asks the user, records a
  decision and finishes.

## Issue templates

`plan-me init` (or `plan-me templates`) writes a GitHub issue form per configured type into `.github/ISSUE_TEMPLATE/`
(`feature.yml`, `bug.yml`, `task.yml`, `design.yml`, `decision.yml`, `epic.yml`) and a `config.yml` (blank issues off),
from the configuration and with no extra settings:

- **Sections per type**: Task, Design, Decision and Epic open with Why, Context and What, then their own (Task: Done
  when; Design: Constraints, Options, Design docs; Decision: Options, Who decides, opens as needs-decision and is
  answered with `decide --question`; Epic: Outcome, Child items, Design docs). Feature: Context, Problem, Expected
  value, Acceptance criteria, Design docs. Bug: Context, Steps to reproduce, Observed behavior, Expected behavior,
  Additional context. The required ones are required in the form and by the issue check.
- **The plan-me fields**: a Component dropdown from `boards`, and Priority, Role and Effort. The form sets the
  organization's issue type (else the `type:` label); the Action copies the answers to the labels, the issue fields
  and the board when the issue is opened.
- **Rerunnable**: unchanged files report `up to date`; a form edited by hand is left alone (`--force` overwrites it);
  `plan-me templates check` for CI and the `plan-me-templates` pre-commit hook; SPDX headers from `.reuse-me.json`.

```sh
$ plan-me templates
write .github/ISSUE_TEMPLATE/feature.yml
...
write .github/ISSUE_TEMPLATE/config.yml
$ plan-me templates
.github/ISSUE_TEMPLATE up to date
```

The guide: [docs/cli.md](./docs/cli.md#issue-templates).

## Configuration

See [docs/config.md](./docs/config.md) for `.plan-me.json`.

## Contributing

If you have suggestions for how plan-me could be improved, or want to report a bug, open an issue! We'd love all and
any contributions.

For more, check out the [Contributing Guide](CONTRIBUTING.md).

## License

- [MIT](./LICENSES/MIT.txt) © 2026 Kevin de Jong \<monkaii@hotmail.com\>
