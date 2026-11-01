---
name: working-with-plan-me
description: Work a backlog kept with plan-me (GitHub issues + Projects v2, decisions as files) - read it, pick the next job, start it, ask the user, record a decision, finish it. Use in any repository with a .plan-me.json, before touching an issue, a board field or docs/decisions, and after a plan-me hook denied a command.
---

# Working with plan-me

A repository with a `.plan-me.json` keeps its backlog on GitHub issues with Projects v2 boards (one board per
component; fields Status, Priority, Role, Size) and its decisions as files in `docs/decisions/`. plan-me's commands
keep the issues, the board fields and the index consistent; `gh issue create`, `gh issue edit` and `gh issue close`
skip the board fields, so this plugin denies them here.

Every command below is also an MCP tool of this plugin's `plan-me` server (`next`, `list`, `show`, `snapshot`, `new`,
`start`, `block`, `ask`, `decide`, `done`, `decisions_index`, `decisions_check`, `decisions_import`), with the same
arguments; add `json: true` (or `--json` on the command line) for structured output. Every command is idempotent: a
retry reports `#12 unchanged`.

## Read the backlog: once, then grep

```sh
plan-me snapshot --out backlog.txt   # the whole open backlog, one line per item; deterministic
grep 'web P1' backlog.txt
```

Each line is `#12 [component priority status role] title — blocked by #9`, epics with their children indented.
Grep the snapshot instead of calling `list` or `show` per item; `show <n>` only for the one item you work on (its
body). Refresh the snapshot after a batch of changes, not after each.

## Pick the next job

```sh
plan-me next --component web --role frontend   # one line: open, unblocked, not an epic
```

The order is P1 before P2 before P3; within a priority in-progress first, then needs-decision, then open. Take what
`next` gives unless the user named the item.

## Start it

```sh
plan-me start 12 --branch 12-editor-toolbar
git switch -c 12-editor-toolbar
```

Status goes to in-progress and the branch is noted in the issue. Put the issue number first in the branch's last
segment (`12-slug`, or `feat/12-slug`): the Action reads it there and moves the item along when the pull request
opens and merges.

## New work

```sh
plan-me new "Autosave drafts" --component api --priority P2 --role backend --type Feature --parent 3 --blocked-by 9
```

`--id <stable-id>` makes a re-run return the existing item instead of a duplicate. Found a blocker while working:
`plan-me block 12 --by 14`.

## Ask the user

Never guess an answer the user must give. Ask, and go on with other work:

```sh
plan-me ask 12 "Should autosave keep every version, or only the last ten?"   # the item becomes needs-decision
plan-me ask "Offline mode for mobile?" "Do we sync drafts made offline?"       # a new question issue
```

## Record a decision

When the user answers (in the chat or on the issue):

```sh
plan-me decide "Autosave keeps the last ten versions per note." --title "Autosave keeps ten versions" \
  --by "the user" --question 12 [--supersedes <old-id>]
```

It writes `docs/decisions/<date>-<id>.md`, regenerates `docs/decisions.md` and answers the question issue. Read the
decisions with `grep` on `docs/decisions.md` (one line each); follow only the current and amended ones, never a
superseded one. To change a decision, record a new one with `--supersedes` or `--amends`.

**Never edit `docs/decisions.md` by hand**: it is generated (`plan-me decisions index`). Never edit an issue form
under `.github/ISSUE_TEMPLATE/` that carries a `# plan-me:sha256=` line: plan-me generates those too. This plugin
denies both, and before `git commit` it runs `plan-me decisions check` when decision files changed.

## Finish

- The pull request says `Closes #12` in its description: on merge the Action closes the issue and sets Status done.
  Work that only contributes says `Part of #12`.
- Finishing without a pull request: `plan-me done 12 --note "What was done and how to try it."`.
- A note on an issue without changing it: `gh issue comment 12 --body "..."` (allowed).

## When a command is denied

The deny message names the plan-me command to use instead; nothing was run. Use that command (or its MCP tool) and
go on.
