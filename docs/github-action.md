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
| `issues` opened | An issue from one of plan-me's forms: its Component answer becomes the component label (unless it has one), its Priority, Role and Size answers the board fields; a Decision becomes needs-decision. Then it is kept consistent (below). |
| `issues` edited, labeled, reopened | That issue is kept consistent (below). |
| `schedule`, `workflow_dispatch` | The whole open backlog is kept consistent. |

Every run, whatever the event, first runs `decisions check` on the checked-out repository: each problem becomes an
error annotation and the run fails at the end (after the backlog work). A repository without `docs/decisions/`
passes. See [decisions.md](./decisions.md). Likewise `templates check`: a generated issue form that is missing or
stale for the configuration fails the run; a repository without plan-me's forms passes.

Form answers: GitHub writes a submitted form as `### <label>` headings with the answers. The Action reads the
`Component` heading and the headings named after the Priority, Role and Size fields (`fields.*.name`); an answer that
is no option of its field, or left empty (`_No response_`), is ignored. Only `opened` reads them, so later edits of the
body never overwrite the board.

Every run also runs `claude check`: a repository with the configuration file must enable the plan-me Claude Code
plugin in `.claude/settings.json` (`plan-me claude install`, or `plan-me init`). Each missing setting becomes an error
annotation and the run fails at the end, like the decisions check. There is no opt-out. See the
[README](../README.md#claude-code-plugin).

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
      - id: app-token
        uses: actions/create-github-app-token@v3
        with:
          client-id: ${{ vars.PLAN_ME_APP_CLIENT_ID }}
          private-key: ${{ secrets.PLAN_ME_APP_PRIVATE_KEY }}
          owner: ${{ github.repository_owner }}
          repositories: ${{ github.event.repository.name }}
      - uses: dev-build-deploy/plan-me@v0
        with:
          token: ${{ steps.app-token.outputs.token }}
          config: .plan-me.json
```

## The token: a GitHub App

The workflow's `GITHUB_TOKEN` cannot write an organization's Projects v2 boards, so the Action needs its own token.
The recommended one is a GitHub App owned by the organization: it is not tied to a person, does not expire, and one
App serves every repository that uses plan-me. Each run turns the App's key into a short-lived token (the usage above).

Once per organization:

1. **Create the App**: the organization's Settings → Developer settings → GitHub Apps → New GitHub App
   (`https://github.com/organizations/<org>/settings/apps/new`).
   - Name: any free name, e.g. `<org>-plan-me` (App names are global).
   - Webhook: untick **Active** (the Action calls the API; the App needs no events).
   - Repository permissions: **Issues** read and write, **Pull requests** read-only (Metadata read-only is automatic).
   - Organization permissions: **Projects** read and write.
   - Installable only on this account.
2. **Note the Client ID** (it starts with `Iv`; not the numeric App ID: `create-github-app-token` deprecated `app-id`)
   and **generate a private key** (a `.pem` file downloads).
3. **Install the App** on the organization, for the repositories that use plan-me.

Once per repository (or once as organization variables and secrets shared with those repositories):

```sh
gh variable set PLAN_ME_APP_CLIENT_ID -R <org>/<repo> --body "<Client ID>"
gh secret set PLAN_ME_APP_PRIVATE_KEY -R <org>/<repo> < <the key>.pem
```

Then delete the downloaded key. The Client ID is not secret: `gh api /apps/<app-slug> --jq .client_id` shows it.

A fine-grained personal access token also works (resource owner: the organization; repository permissions Issues read
and write, Pull requests read; organization permission Projects read and write), passed as `token:` from a secret. It
acts as its owner and expires.

## Inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `token` | `github.token` | A token with Issues read/write **and Projects access**. The workflow's `GITHUB_TOKEN` cannot write organization Projects v2: use a GitHub App token ([the token](#the-token-a-github-app)) or a fine-grained personal access token. |
| `config` | `.plan-me.json` | The configuration file ([config.md](./config.md)); `repository` defaults to the workflow's repository. |

## Outputs

| Output | Meaning |
| --- | --- |
| `changes` | The changes made, as a JSON list of lines (e.g. `["#12 in-progress (#40)"]`). |
