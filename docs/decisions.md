<!--
SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
SPDX-License-Identifier: MIT
-->

# Decisions

A project makes decisions all the time: "we use Lua for scripts", "the backlog lives on GitHub". People and LLM
agents need to find the decisions that are valid today, and must never act on one that was replaced. plan-me keeps
them as files in the repository, next to the code they shape, with a generated index that is easy to read and grep.

Every repository using plan-me gets the same behaviour with no configuration:

| What | Where |
| --- | --- |
| One file per decision | `docs/decisions/<date>-<id>.md` |
| The index (generated, never edited by hand) | `docs/decisions.md` |

There is no setting for other paths or more decision sets yet: whether a repository may deviate from the defaults is
still an open question for the owner. (The code takes the folder and index path as one parameter, so a second set can
be added later without a rewrite.)

## A decision file

```markdown
---
id: decisions-are-files
number:
date: 2026-11-01
by: "the owner"
status: current
superseded_by:
scope: [docs, tooling]
summary: "Decisions are files, managed by plan-me"
question: "#42"
---

# Decisions are files, managed by plan-me

One file per decision in docs/decisions/, an index plan-me generates, ...
```

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | A unique slug (`a-z`, `0-9`, single dashes). The file must be named `<date>-<id>.md`. |
| `number` | no | Only for decisions imported from an old numbered list: the original label (`129`, `L99`), so old references such as "decision 129" or "L99" still resolve. New decisions never get a number: two branches would pick the same "next number". |
| `date` | yes | `YYYY-MM-DD`, the day it was decided. |
| `by` | yes | Who decided: `the user`, `the owner`, a name. |
| `status` | yes | `current` (valid), `amended` (valid, but a later decision changed part of it), `superseded` (replaced: history only). |
| `superseded_by` | for superseded | The id of the decision that replaces it, or (for `amended`) the one that changed it. |
| `scope` | no | A list of areas it applies to (`[engine, ui]`). |
| `summary` | yes | One line for the index. |
| `question` | no | The question issue it answered (`"#42"`, quoted because YAML reads `#` as a comment). |

After the front matter: the title as a `# heading`, then the decision in full, in whatever words it needs.

plan-me writes the front matter itself, always with the same keys in the same order. You may edit the text below the
title by hand at any time; if you edit the front matter, run `plan-me decisions index` afterwards.

## The index

`docs/decisions.md` is generated from the files. It starts with a comment saying so, and lists one line per decision:

```text
- <id> · <number or -> · <date> · <status> · <scope or -> · <summary>
```

Three sections, in this order:

1. **Current**: valid, follow these.
2. **Amended**: still valid, but read the decision named after `amended by` too.
3. **Superseded**: history only. Never follow these; follow the decision named after `superseded by`.

Within a section the newest come first (then the higher number, then the id). Lines from Birchling's imported list:

```text
- backlog-on-github-issues-plan-me · 128 · 2026-10-25 · current · - · Backlog on GitHub issues (plan-me), docs to the Wiki (docs-me)
- the-sky-fight-keeps-its-show · 127 · 2026-10-16 · current · - · The sky fight keeps its show
- lua-is-the-games-script-language · 102 · 2026-10-14 · current · - · Lua is the game's script language
- day-and-night-lengths-in-data · 82 · 2026-10-12 · current · - · Day and night lengths in data: 3 minutes of day, 3 of night (3/2 to try)
- longer-nights-b · 79 · 2026-10-11 · amended by day-and-night-lengths-in-data · - · Longer nights (B)
```

Finding things: `grep " · 129 · " docs/decisions.md` finds old decision 129, `grep " · L99 · "` finds L99,
`grep "· current ·.*engine"` finds the current engine decisions. Then open `docs/decisions/<date>-<id>.md` for the
full text.

The index has no timestamps and no counts, so regenerating it gives the same bytes, and two branches that each add a
decision touch different lines. If git still reports a conflict in `docs/decisions.md` after a merge, don't resolve it
by hand: take either side and run `plan-me decisions index`. To let git merge it on its own, you can add this line to
the repository's `.gitattributes`; the check below catches anything the union merge gets wrong:

```text
docs/decisions.md merge=union
```

## Commands

The same commands exist as MCP tools (`decide`, `decisions_index`, `decisions_check`, `decisions_import`; see
[mcp.md](./mcp.md)). They work on the files under the current directory (run them from the repository root) and need
no token, except `decide --question`, which writes to the question issue.

### Record a decision

```sh
plan-me decide "One file per decision in docs/decisions/, an index plan-me generates." \
  --title "Decisions are files, managed by plan-me" --by "the owner" \
  [--summary "one line"] [--scope docs --scope tooling] [--question 42] \
  [--supersedes old-id] [--amends other-id] [--date 2026-11-01] [--id my-id]
```

- writes `docs/decisions/<date>-<id>.md` (the id is the title's slug unless you give `--id`) and regenerates the index;
- `--supersedes <id>` marks that decision `superseded` with `superseded_by` set to the new one; `--amends <id>`
  marks it `amended`;
- `--question 42` answers the question issue (below);
- running it again with the same input changes nothing (`unchanged`); a different decision with the same id is an
  error: pass `--id`.

`decide` without `--title` keeps its old meaning: `plan-me decide 42 --question "Files or a database?"` marks issue
#42 needs-decision and posts the question as a comment.

### Regenerate the index

```sh
plan-me decisions index     # docs/decisions.md written | docs/decisions.md up to date
```

### Check

```sh
plan-me decisions check     # docs/decisions: ok, or one line per problem and exit code 1
```

It fails when:

- a file's front matter is invalid (a missing field, a bad status or date, a `superseded` decision without
  `superseded_by`, a `current` one with it, a summary over more than one line) or the file name isn't
  `<date>-<id>.md`;
- two files share an id, or two imported decisions share a number;
- a `superseded_by` names no decision;
- the index is missing, stale (a file was added or changed without `decisions index`) or edited by hand. The message
  names the first line that differs.

A repository without a `docs/decisions/` folder doesn't use decisions and always passes.

### Import an old numbered list

```sh
plan-me decisions import docs/decisions.md --format numbered [--by "the user"] [--scope game] [--dry-run]
```

Two formats:

| Format | An entry looks like |
| --- | --- |
| `numbered` | `129. **Title** (2026-11-01, the user): text`. The date can also come from a `## 2026-10-10 ...` heading above the entry. |
| `labelled` | `- **L99** (2026-10-27) text`. The title is the text's first sentence, without remarks such as `(the user: "...")`. |

In both, indented lines continue the entry (numbered sub-points included); the whole entry is copied below the
title, as written. The import:

- keeps the label as `number` (`129`, `L99`);
- makes the id from the title's first six words; when two entries (or an existing file) share that slug, the label
  is appended (`same-title-l12`);
- takes `by` from the entry only when it says `the user`, `the owner`, `the lead` or `the team`, else from `--by`
  (default `unknown`);
- applies the changes an entry states about earlier entries, conservatively, within one sentence (split at `.` and
  `;`) containing supersede, replace, refine or amend: `Supersedes L3` or `replaces 9` (the reference right after the
  verb) marks that one `superseded`; `refines L50`, `... in L3`, `of L65`, `L96's ...` (numbered lists:
  `in decision 42`, `decision 42's`) marks it `amended`. When several later entries change one, the newest is named;
- is rerunnable: an entry whose number already has a file is skipped (`exists`).

Importing `docs/decisions.md` replaces that file with the generated index at the end; the old list stays in git's
history. Read the imported files once: the import is a careful start, not a judgement, so fix a status or a title
by hand where the old text was ambiguous, then run `plan-me decisions index`.

## From question to decision

Open questions are issues with status needs-decision. The flow:

1. **Ask.** Someone files the question as an issue and marks it: `plan-me decide 42 --question "Files or a
   database?"` (status needs-decision, the question as a comment). `plan-me next` lists needs-decision items first
   within a priority, so they get answered.
2. **Answer.** The person who decides answers on the issue (or anywhere).
3. **Record.** In the branch that carries the change, run `plan-me decide "<the answer>" --title ... --by ...
   --question 42`. This writes the decision file and the index, and on issue #42: a comment with the answer and the
   file's path, a `Decision: docs/decisions/<file>` line in its body, status in-progress. The issue stays open.
4. **Close.** The pull request carrying the file says `Closes #42` in its description. When it merges, GitHub closes
   the issue and plan-me's Action marks it done. Until then the decision isn't on the default branch, so the
   question isn't really settled yet.

## Automation

- **GitHub Action**: every run first does `decisions check` on the checked-out repository (use `actions/checkout`
  before it) and reports each problem as an error annotation; the run fails at the end when there were problems.
- **pre-commit hook**: add plan-me to the repository's `.pre-commit-config.yaml`; it runs `decisions check` when a
  file under `docs/decisions` changes.

```yaml
- repo: https://github.com/dev-build-deploy/plan-me
  rev: v0.1.0   # the plan-me release to use
  hooks:
  - id: plan-me-decisions
```
