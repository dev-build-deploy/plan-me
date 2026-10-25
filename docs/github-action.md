<!--
SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
SPDX-License-Identifier: MIT
-->

# GitHub Action

The Action is plan-me's automation: no hosting, it runs in the managed repository's workflows. Every run is
idempotent: rerunning an event changes nothing.

| Event | What happens |
| --- | --- |
| `pull_request` opened, edited, synchronize, reopened, ready_for_review | The issues it references move to in-progress: `Closes #n` (fixes, resolves), `Part of #n`, or the number in the branch name (`feat/12-x`; or a branch whose last segment is an item's marker id). |
| `pull_request` closed and merged | `Closes` and branch issues: a Done comment ("Merged in #PR."), closed, status done. `Part of` issues stay in-progress. |
| `issues` closed | Status done; dependents whose blockers are now all closed go from blocked back to open, with a comment. |
| `issues` opened, edited, labeled, reopened | That issue is kept consistent (below). |
| `schedule`, `workflow_dispatch` | The whole open backlog is kept consistent. |

Consistency: an issue without a Priority gets the configured default and a comment; an issue without a Status gets
open; a blocked issue whose blockers are all closed goes back to open (with a comment). Issues whose component has no
board are left alone.

## Usage

```yaml
name: Backlog
on:
  issues:
    types: [opened, edited, labeled, reopened, closed]
  pull_request:
    types: [opened, edited, synchronize, reopened, ready_for_review, closed]
  schedule:
    - cron: "17 5 * * *"
  workflow_dispatch:

permissions:
  issues: write
  pull-requests: read

jobs:
  plan-me:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: dev-build-deploy/plan-me@v0
        with:
          token: ${{ secrets.PLAN_ME_TOKEN }}
          config: .plan-me.json
```

## Inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `token` | `github.token` | A token with Issues read/write **and Projects access**. The workflow's `GITHUB_TOKEN` cannot write organization Projects v2: use a GitHub App token (organization "Projects: read and write") or a PAT with the `project` scope. |
| `config` | `.plan-me.json` | The configuration file ([config.md](./config.md)); `repository` defaults to the workflow's repository. |

## Outputs

| Output | Meaning |
| --- | --- |
| `changes` | The changes made, as a JSON list of lines (e.g. `["#12 in-progress (#40)"]`). |
