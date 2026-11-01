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

Within a section the newest come first (then the higher number, then the id). Lines from an imported numbered list:

```text
- backlog-on-github-issues-plan-me · 128 · 2026-10-25 · current · - · Backlog on GitHub issues (plan-me), docs to the Wiki (docs-me)
- the-editor-keeps-its-preview · 127 · 2026-10-16 · current · - · The editor keeps its preview
- lua-is-the-plugin-language · 102 · 2026-10-14 · current · - · Lua is the plugin language
- trial-and-grace-lengths-in-data · 82 · 2026-10-12 · current · - · Trial and grace lengths in data: 14 days of trial, 14 of grace (14/7 to try)
- longer-trials-b · 79 · 2026-10-11 · amended by trial-and-grace-lengths-in-data · - · Longer trials (B)
```

Finding things: `grep " · 129 · " docs/decisions.md` finds old decision 129, `grep " · L99 · "` finds L99,
`grep "· current ·.*engine"` finds the current engine decisions. Then open `docs/decisions/<date>-<id>.md` for the
full text.

The index has no timestamps and no counts, so regenerating it gives the same bytes.

## Merging branches: the merge driver

Two branches that each add a decision both change `docs/decisions.md`, often at the same spot (both new lines go to
the top of Current). A plain text merge then reports a conflict, although nothing really conflicts: the decision
files are separate and the index can be generated again. plan-me ships a **git merge driver** for this. With it, git
doesn't merge the index as text: it hands the three versions (the common ancestor, ours, theirs) to
`plan-me decisions merge-driver`, which merges the decisions they list by id and writes the index again in the
generator's exact format. Your branch's new line and theirs both end up in it, in the right order, and a status change
on one side (say, `superseded by ...`) is kept.

Set it up once per clone:

```sh
plan-me decisions install
```

It does two things:

1. adds `docs/decisions.md merge=plan-me-decisions` to `.gitattributes`. This file is shared: commit it (once per
   repository);
2. adds the driver to this clone's git configuration (`merge.plan-me-decisions.driver = plan-me decisions
   merge-driver %O %A %B`). Git never shares its configuration, so every clone runs `install` once; until then git
   merges the index as text. `plan-me` must be on the PATH; pass `--command "<how to start plan-me>"` otherwise
   (e.g. `--command "npx plan-me"`).

Running `install` again changes nothing. If one side's index isn't a valid generated index (someone edited it by
hand), the driver gives up and git reports a normal conflict; take either side and run `plan-me decisions index`.
After any merge, `plan-me decisions check` (the pre-commit hook and the Action run it) confirms that the index matches
the decision files.

Note: GitHub's merge button and its "Update branch" button don't run custom merge drivers. When GitHub says a pull
request has a conflict in `docs/decisions.md`, merge the default branch into it locally (`git merge main`; the
driver resolves the index) and push.

## Commands

The same commands exist as MCP tools (`ask`, `decide`, `decisions_index`, `decisions_check`, `decisions_import`;
see [mcp.md](./mcp.md)); `decisions install` and `decisions merge-driver` are for git and the CLI only. The decision
commands work on the files under the current directory (run them from the repository root) and need no token, except
`ask` and `decide --question`, which write to GitHub issues.

### Open a question

```sh
plan-me ask 42 "Files or a database?"                          # issue #42 becomes needs-decision, the question as a comment
plan-me ask "Where do decisions live?" "Files or a database?"  # a new issue with that title, needs-decision
```

The first argument is an issue (`42`, `#42`, or an item id); anything else is the title of a new question issue
(type Decision when the repository has it; asking again with the same title returns the same issue).

### Record a decision

```sh
plan-me decide "One file per decision in docs/decisions/, an index plan-me generates." \
  --title "Decisions are files, managed by plan-me" --by "the owner" \
  [--summary "one line"] [--scope docs --scope tooling] [--question 42] \
  [--supersedes old-id] [--amends other-id] [--date 2026-11-01] [--id my-id]
```

- writes `docs/decisions/<date>-<id>.md` and regenerates the index. The id is the title's slug unless you give
  `--id`: its first six words, lowercase, without the stop words that end the cut (`the`, `a`, `in`, `of`, `from`,
  `to`, `is`, `and`, ...) and without a leading `the` ("The report is built from the nightly data" ->
  `report-is-built`);
- `--supersedes <id>` marks that decision `superseded` with `superseded_by` set to the new one; `--amends <id>`
  marks it `amended`;
- `--question 42` answers question issue #42 (below); in `decide`, `--question` is always an issue number;
- running it again with the same input changes nothing (`unchanged`); a different decision with the same id is an
  error: pass `--id`.

The old form `plan-me decide 42 --question "Files or a database?"` (without `--title`) still works for now: it
does what `ask` does and prints a warning that it is deprecated and names `ask`.

### Licence headers

If the repository has a `.reuse-me.json` (the configuration of dev-build-deploy/reuse-me, which checks that every file
says who owns it and under which licence), `decide`, `decisions import` and `decisions index` put an SPDX header in
each file they write, as an HTML comment right after the front matter, so a file copied out of the repository still
says who owns it:

<!-- REUSE-IgnoreStart -->
```markdown
---
id: decisions-are-files
...
---

<!--
SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
SPDX-License-Identifier: CC-BY-4.0
-->

# Decisions are files, managed by plan-me
```
<!-- REUSE-IgnoreEnd -->

The holder and licence come from the first rule in `.reuse-me.json` whose `paths` match the file (for example
`"paths": ["docs/**"]`), else from its `defaults`, else (for the licence) from the only file in `LICENSES/`, the
same way reuse-me reads them. The year is the rule's `year` if it has one, else the decision's year (for the index:
the oldest decision's year), so the output doesn't change with the calendar. A path in `exclude`, or no holder or
licence, means no header. Without a `.reuse-me.json`, plan-me writes no header at all.

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
- makes the id from the title's slug (see `decide`); when two entries (or an existing file) share that slug, the
  label is appended (`same-title-l12`);
- takes `by` from the entry only when it says `the user`, `the owner`, `the lead` or `the team`, else from `--by`
  (default `unknown`);
- applies the changes an entry states about earlier entries, conservatively, within one sentence (split at `.` and
  `;`) containing supersede, replace, refine or amend: `Supersedes L3` or `replaces 9` (the reference right after the
  verb) marks that one `superseded`; `refines L50`, `... in L3`, `of L65`, `L96's ...` (numbered lists:
  `in decision 42`, `decision 42's`) marks it `amended`. When several later entries change one, the newest is named;
- is rerunnable: an entry whose number already has a file is skipped (`exists`), and that file keeps its id even
  when a newer plan-me would slug the title differently.

Importing `docs/decisions.md` replaces that file with the generated index at the end; the old list stays in git's
history. Read the imported files once: the import is a careful start, not a judgement, so fix a status or a title
by hand where the old text was ambiguous, then run `plan-me decisions index`.

## From question to decision

Open questions are issues with status needs-decision. The flow:

1. **Ask.** Someone opens the question: `plan-me ask 42 "Files or a database?"` for an existing issue, or
   `plan-me ask "Where do decisions live?" "Files or a database?"` for a new one (status needs-decision). `plan-me next` lists needs-decision items first
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
