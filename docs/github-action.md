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
| `issues` closed | Status done; dependents whose blockers are now all closed go from blocked back to open, with a comment. Only the issues the closed one blocked are read, so a burst of closes stays cheap (with GitHub's native dependencies; body-line blockers need the whole backlog). |
| `issues` opened | An issue from one of plan-me's forms: its Component answer becomes the component label (unless it has one), its Priority, Role and Size answers the board fields; a Decision becomes needs-decision. Then it is kept consistent (below). |
| `issues` opened, edited | The [issue check](./cli.md#the-issue-check) on its title, type and body (below). |
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

## The issue check on opened and edited issues

An issue opened in the UI (a blank issue, or a form whose sections were filled with notes) is held to the same bar as
one made with `new` or `import`: the Action runs the [issue check](./cli.md#the-issue-check) when an issue is opened
or edited. Each finding becomes an error or warning annotation, and the issue gets **one** comment listing the
problems and, on errors, the sections its type needs:

```markdown
**plan-me issue check:** 1 error(s), 1 warning(s). Edit the issue to fix them; this comment follows the edits.

**Errors** (the issue is not understandable on its own yet):
- line 1: error: [PI005] The "Context" section is missing. Fix: Add a "### Context" heading with its text. ...

**Warnings:**
- line 3: warning: [DevBuildDeploy.Weasel] 'very' weakens the sentence: give the fact or the number instead. ...
```

Later edits update that comment in place (it carries a hidden `<!-- plan-me:issue-check -->` marker), never a second
one; once the issue passes, it says **resolved**. An issue that passes from the start gets no comment. With
`issue-check-label` set, a failing issue also gets that label, removed once it passes. The check does not fail the
run: the comment is the signal. The prose rules need Vale, which the Action downloads (pinned, checksum verified)
on the runner; the glossary is read from the checkout. `issue-check: false` turns it off.

Consistency: an issue without a Priority gets the configured default and a comment; an issue without a Status gets
open; a blocked issue whose blockers are all closed goes back to open (with a comment). Issues whose component has no
board are left alone.

API budget: an issue event reads only the issues it touches (with native dependencies), and the whole backlog is
read only on `schedule` and `workflow_dispatch`, or when blockers are body lines. All runs share the token's hourly
GitHub API budget (5,000 requests for a GitHub App installation). When a run still hits GitHub's rate limit, it ends
with a warning instead of failing: the next event, or the nightly sweep, catches up.

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
| `issue-check` | `true` | Check the text of opened and edited issues: annotations and one comment on the issue ([the issue check](#the-issue-check-on-opened-and-edited-issues)). `false` turns it off. |
| `issue-check-label` | (empty) | A label added to issues that fail the issue check, removed once they pass; empty: no label. |

## Outputs

| Output | Meaning |
| --- | --- |
| `changes` | The changes made, as a JSON list of lines (e.g. `["#12 in-progress (#40)"]`). |
