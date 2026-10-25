/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { appendLine, GitHubApi, OctokitLike, parseBodyLinks } from "../src/github.js";

type Call = { query: string; vars?: Record<string, unknown> };

/** A mocked Octokit: GraphQL answers picked by a matcher on the query text; REST calls recorded. */
type Mock = { octokit: OctokitLike; graphql: Call[]; rest: { route: string; params?: Record<string, unknown> }[] };

function mock(answers: [RegExp, unknown][], native = true): Mock {
  const graphql: Call[] = [];
  const rest: { route: string; params?: Record<string, unknown> }[] = [];
  const fields = native ? ["subIssues", "parent", "blockedBy", "blocking"] : ["title"];
  const octokit: OctokitLike = {
    graphql: (async (query: string, vars?: Record<string, unknown>) => {
      graphql.push({ query, vars });
      if (query.includes("__type")) {
        return {
          __type: { fields: fields.map(name => ({ name })) },
          repository: { issueTypes: { nodes: native ? [{ name: "Bug" }] : [] } },
        };
      }
      const hit = answers.find(([re]) => re.test(query));
      if (!hit) throw new Error(`unexpected query ${query.slice(0, 60)}`);
      return typeof hit[1] === "function" ? (hit[1] as (v?: Record<string, unknown>) => unknown)(vars) : hit[1];
    }) as OctokitLike["graphql"],
    request: async (route: string, params?: Record<string, unknown>) => {
      rest.push({ route, params });
      if (route.startsWith("GET /repos/{owner}/{repo}/labels")) return { data: [{ name: "Component:Engine" }] };
      return { data: { node_id: "I_9", number: 9, title: "T", body: "b", html_url: "u" } };
    },
  };
  return { octokit, graphql, rest };
}

const issue = (number: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: `I_${number}`,
  number,
  title: `Issue ${number}`,
  body: "",
  state: "OPEN",
  url: `u${number}`,
  labels: { nodes: [{ name: "component:engine" }] },
  issueType: { name: "Bug" },
  parent: null,
  subIssues: { nodes: [] },
  blockedBy: { nodes: [{ number: 1, state: "CLOSED" }] },
  blocking: { nodes: [] },
  projectItems: {
    nodes: [
      {
        project: { title: "Engine" },
        fieldValues: {
          nodes: [{ name: "In Progress", field: { name: "Status" } }, { text: "helper", field: { name: "Role" } }, {}],
        },
      },
    ],
  },
  ...extra,
});

const PROJECT = {
  id: "P_1",
  number: 1,
  title: "Engine",
  fields: {
    nodes: [
      {
        id: "F_s",
        name: "Status",
        dataType: "SINGLE_SELECT",
        options: [{ id: "o1", name: "Todo", color: "GRAY", description: "" }],
      },
      { id: "F_r", name: "Role", dataType: "TEXT" },
    ],
  },
};

describe("GitHubApi", () => {
  test("lists issues across pages with native links and board fields", async () => {
    let page = 0;
    const { octokit, graphql } = mock([
      [
        /issues\(first/,
        () => ({
          repository: {
            issues: {
              pageInfo: { hasNextPage: page === 0, endCursor: "c1" },
              nodes: [issue(++page + 1)],
            },
          },
        }),
      ],
    ]);
    const api = new GitHubApi(octokit, "o/r", "o");
    const issues = await api.listIssues(false);
    expect(issues.map(i => i.number)).toEqual([2, 3]);
    expect(issues[0]).toMatchObject({
      issueType: "Bug",
      blockedBy: [{ number: 1, open: false }],
      boards: { Engine: { Status: "In Progress", Role: "helper" } },
    });
    expect(graphql[2].vars).toMatchObject({ after: "c1", states: ["OPEN"] });
    expect(graphql[1].query).toContain("blockedBy");
  });

  test("falls back to body lines without native sub-issues and dependencies", async () => {
    const body = "Text\n\nParent: #4\nBlocked by #5, #6\n- [ ] #7\n";
    const { octokit, graphql } = mock(
      [[/issue\(number/, { repository: { issue: issue(3, { body, issueType: undefined }) } }]],
      false
    );
    const api = new GitHubApi(octokit, "o/r", "o");
    const raw = await api.getIssue(3);
    expect(raw).toMatchObject({ parent: 4, blockedBy: [{ number: 5 }, { number: 6 }], children: [{ number: 7 }] });
    expect(graphql[1].query).not.toContain("blockedBy");
    expect(graphql[1].query).not.toContain("issueType");
  });

  test("fallback writes: sub-issue and blocker as body lines", async () => {
    const { octokit, rest } = mock([], false);
    const api = new GitHubApi(octokit, "o/r", "o");
    const base = { title: "", open: true, url: "", labels: [], children: [], blockedBy: [], blocking: [], boards: {} };
    await api.addSubIssue(
      { ...base, nodeId: "a", number: 1, body: "Epic" },
      { ...base, nodeId: "b", number: 2, body: "" }
    );
    await api.addBlockedBy(
      { ...base, nodeId: "b", number: 2, body: "Parent: #1\n" },
      { ...base, nodeId: "c", number: 3, body: "" }
    );
    expect(rest.map(r => [r.params?.issue_number, r.params?.body])).toEqual([
      [2, "Parent: #1\n"],
      [1, "Epic\n\n- [ ] #2\n"],
      [2, "Parent: #1\n\nBlocked by #3\n"],
    ]);
  });

  test("native writes use the GraphQL mutations", async () => {
    const { octokit, graphql } = mock([
      [/addSubIssue/, {}],
      [/addBlockedBy/, {}],
    ]);
    const api = new GitHubApi(octokit, "o/r", "o");
    const base = {
      title: "",
      body: "",
      open: true,
      url: "",
      labels: [],
      children: [],
      blockedBy: [],
      blocking: [],
      boards: {},
    };
    await api.addSubIssue({ ...base, nodeId: "A", number: 1 }, { ...base, nodeId: "B", number: 2 });
    await api.addBlockedBy({ ...base, nodeId: "B", number: 2 }, { ...base, nodeId: "C", number: 3 });
    expect(graphql[1].vars).toEqual({ issueId: "A", subIssueId: "B" });
    expect(graphql[2].vars).toEqual({ issueId: "B", blockingIssueId: "C" });
  });

  test("setFields resolves option ids and text fields", async () => {
    const { octokit, graphql } = mock([
      [/projectsV2\(first/, { repositoryOwner: { projectsV2: { nodes: [PROJECT] } } }],
      [/addProjectV2ItemById/, { addProjectV2ItemById: { item: { id: "PI_1" } } }],
      [/updateProjectV2ItemFieldValue/, {}],
    ]);
    const api = new GitHubApi(octokit, "o/r", "o");
    const raw = {
      nodeId: "I_1",
      number: 1,
      title: "",
      body: "",
      open: true,
      url: "",
      labels: [],
      children: [],
      blockedBy: [],
      blocking: [],
      boards: {},
    };
    await api.setFields(raw, { title: "Engine" }, { Status: "Todo", Role: "lead" });
    const updates = graphql.filter(c => c.query.includes("updateProjectV2ItemFieldValue")).map(c => c.vars);
    expect(updates).toEqual([
      { projectId: "P_1", itemId: "PI_1", fieldId: "F_s", value: { singleSelectOptionId: "o1" } },
      { projectId: "P_1", itemId: "PI_1", fieldId: "F_r", value: { text: "lead" } },
    ]);
    await expect(api.setFields(raw, { title: "Engine" }, { Status: "Nope" })).rejects.toThrow(/plan-me init/);
    await expect(api.setFields(raw, { title: "Missing" }, {})).rejects.toThrow(/not found/);
  });

  test("ensureBoard adds missing options keeping the existing ones; dry run changes nothing", async () => {
    const { octokit, graphql } = mock([
      [/projectsV2\(first/, { repositoryOwner: { projectsV2: { nodes: [PROJECT] } } }],
      [/updateProjectV2Field\(/, {}],
      [/createProjectV2Field/, {}],
    ]);
    const api = new GitHubApi(octokit, "o/r", "o");
    const specs = [
      { name: "Status", options: ["Todo", "Blocked"] },
      { name: "Priority", options: ["P1"] },
    ];
    const dry = await api.ensureBoard({ title: "Engine" }, specs, true);
    expect(dry).toEqual(['add options Blocked to "Status" on "Engine"', 'create field "Priority" on "Engine"']);
    expect(graphql.some(c => c.query.includes("mutation"))).toBe(false);
    await api.ensureBoard({ title: "Engine" }, specs, false);
    const update = graphql.find(c => c.query.includes("updateProjectV2Field("));
    expect(update?.vars).toEqual({
      input: {
        fieldId: "F_s",
        singleSelectOptions: [
          { id: "o1", name: "Todo", color: "GRAY", description: "" },
          { name: "Blocked", color: "GRAY", description: "" },
        ],
      },
    });
    expect(await api.ensureBoard({ title: "New" }, specs, true)).toEqual([
      'create board "New"',
      'create field "Status" on "New"',
      'create field "Priority" on "New"',
    ]);
  });

  test("ensureLabels skips existing labels case-insensitively", async () => {
    const { octokit, rest } = mock([]);
    const api = new GitHubApi(octokit, "o/r", "o");
    const actions = await api.ensureLabels([{ name: "component:engine" }, { name: "type:epic" }], false);
    expect(actions).toEqual(["create label type:epic"]);
    expect(rest.filter(r => r.route.startsWith("POST")).map(r => r.params?.name)).toEqual(["type:epic"]);
  });

  test("createIssue sends the issue type", async () => {
    const { octokit, rest } = mock([]);
    const api = new GitHubApi(octokit, "o/r", "o");
    const raw = await api.createIssue({ title: "T", body: "b", labels: ["x"], issueType: "Bug" });
    expect(rest[0].params).toMatchObject({ title: "T", type: "Bug", labels: ["x"] });
    expect(raw).toMatchObject({ number: 9, nodeId: "I_9", issueType: "Bug" });
  });
});

describe("body helpers", () => {
  test("appendLine is idempotent", () => {
    expect(appendLine("", "Branch: x")).toBe("Branch: x\n");
    expect(appendLine("Body\nBranch: x\n", "Branch: x")).toBe("Body\nBranch: x\n");
  });

  test("parseBodyLinks", () => {
    expect(parseBodyLinks("Blocked by: #1 #2\nblocked by #3")).toEqual({
      parent: undefined,
      blockedBy: [1, 2, 3],
      children: [],
    });
  });
});
