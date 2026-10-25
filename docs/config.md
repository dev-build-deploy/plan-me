<!--
SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
SPDX-License-Identifier: MIT
-->

# Configuration

PlanMe reads `.plan-me.json` from the working directory (`--config <file>` in the CLI, `config` in the Action).
Everything except `repository` has a default; in the Action `repository` defaults to the workflow's repository.

```json
{
  "repository": "dev-build-deploy/birchling",
  "owner": "dev-build-deploy",
  "boards": {
    "engine": "Engine",
    "birchling": "Birchling",
    "leertoren": { "title": "De Leertoren", "number": 7 }
  },
  "defaultComponent": "birchling",
  "componentLabelPrefix": "component:",
  "fields": {
    "status": {
      "name": "Status",
      "options": { "open": "Todo", "in-progress": "In Progress", "needs-decision": "Needs decision", "blocked": "Blocked", "done": "Done" }
    },
    "priority": { "name": "Priority", "options": ["P1", "P2", "P3"], "default": "P2" },
    "role": { "name": "Role", "options": ["lead", "feature-dev", "engine-dev", "feel-polish", "user"] },
    "size": { "name": "Size", "options": ["XS", "S", "M", "L", "XL"] }
  },
  "types": ["Feature", "Bug", "Task", "Design", "Decision", "Epic"],
  "typeLabelPrefix": "type:",
  "epicType": "Epic",
  "labels": [{ "name": "agent-ready", "color": "0e8a16", "description": "Ready for an agent" }],
  "branchPattern": "(?:^|/)(\\d+)(?=[-_/]|$)"
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `repository` | (required) | The managed repository, `owner/name`. |
| `owner` | the repository owner | The organization (or user) owning the boards. |
| `boards` | `{}` | Component -> board. A string is the board title; `{title, number}` finds it by number. The title must match the board's title (it keys the field values). |
| `defaultComponent` | the first board | The component of issues without a component label. |
| `componentLabelPrefix` | `component:` | The label naming an issue's component (`component:engine`). |
| `fields.status` | see above | The Status field; `options` maps plan-me's five statuses to option names. The defaults reuse the built-in Todo/In Progress/Done so the board's own workflows keep working. |
| `fields.priority` | P1, P2, P3; default P2 | Ordered: the first option is the most urgent. `default` is given to new items and by the Action to items without one. |
| `fields.role` | free text | The role that does the item. With `options` a single select; without, a text field. |
| `fields.size` | XS-XL | The size. |
| `types` | Feature, Bug, Task, Design, Decision, Epic | The item types. Each uses the organization's issue type of that name when it exists, else the label `type:<name>`. |
| `epicType` | `Epic` | The type `next` skips and the snapshot marks `epic`. |
| `labels` | `[]` | Extra labels `init` creates (strings or `{name, color, description}`). |
| `branchPattern` | `(?:^\|/)(\d+)(?=[-_/]\|$)` | The Action's regex for the issue number in a branch name (`feat/12-x`, `12-x`). |

Options may be given as a list (option name = key) or as a map from key to option name.

## Authentication

The CLI uses `GITHUB_TOKEN`, then `GH_TOKEN`, then `gh auth token`. Projects v2 need the `project` scope (classic
token) or the organization's "Projects" permission (fine-grained token or GitHub App), next to Issues read/write.
