/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import {
  Features,
  FieldSpec,
  IssueComment,
  IssueFieldInfo,
  IssueUpdate,
  Link,
  NewIssue,
  PlanApi,
  RawIssue,
} from "./api";
import { BoardConfig, LabelConfig } from "./config";

/** The two Octokit calls plan-me uses (satisfied by `@actions/github`'s getOctokit and by test mocks). */
export interface OctokitLike {
  graphql: <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;
  request: (route: string, params?: Record<string, unknown>) => Promise<{ data: unknown }>;
}

const PAGE_SIZE = 50;
const MAX_LABELS = 50;
const MAX_LINKS = 50;
const MAX_BOARDS_PER_ISSUE = 10;
const MAX_FIELD_VALUES = 30;
const MAX_PROJECTS = 100;
const MAX_FIELDS = 50;
const MAX_ISSUE_FIELDS = 50;
const DEFAULT_LABEL_COLOR = "ededed";
const DEFAULT_OPTION_COLOR = "GRAY";

/** Body-line fallbacks used when the repository lacks native sub-issues or dependencies. */
export const PARENT_LINE = /^Parent: #(\d+)\s*$/im;
export const BLOCKED_BY_LINE = /^Blocked by:? ((?:#\d+[ ,]*)+)\s*$/gim;
export const TASK_LIST_LINE = /^- \[[ xX]\] #(\d+)\s*$/gm;

type Node = Record<string, unknown>;
type GqlIssue = {
  id: string;
  number: number;
  title: string;
  body: string;
  state: string;
  url: string;
  labels: { nodes: { name: string }[] };
  issueType?: { name: string } | null;
  parent?: { number: number } | null;
  subIssues?: { nodes: GqlLink[] };
  blockedBy?: { nodes: GqlLink[] };
  blocking?: { nodes: GqlLink[] };
  projectItems: { nodes: { project: { title: string }; fieldValues: { nodes: Node[] } }[] };
  issueFieldValues?: { nodes: Node[] };
};
type GqlIssueField = { id?: string; name?: string; dataType?: string; options?: IssueFieldInfo["options"] };
type GqlLink = { number: number; state: string };
type ProjectField = {
  id: string;
  name: string;
  dataType: string;
  options?: { id: string; name: string; color: string; description: string }[];
};
type Project = { id: string; number: number; title: string; fields: { nodes: ProjectField[] } };

const FIELD_VALUES = `projectItems(first: ${MAX_BOARDS_PER_ISSUE}) { nodes { project { title }
  fieldValues(first: ${MAX_FIELD_VALUES}) { nodes {
    ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
    ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } } } } } }`;
const PROJECT_FIELDS = `id number title fields(first: ${MAX_FIELDS}) { nodes {
  ... on ProjectV2FieldCommon { id name dataType }
  ... on ProjectV2SingleSelectField { options { id name color description } } } }`;

const ISSUE_FIELD_VALUES = `issueFieldValues(first: ${MAX_ISSUE_FIELDS}) { nodes {
  ... on IssueFieldSingleSelectValue { name field { ... on IssueFieldCommon { name } } }
  ... on IssueFieldTextValue { value field { ... on IssueFieldCommon { name } } } } }`;
const ISSUE_FIELDS = `issueFields(first: ${MAX_ISSUE_FIELDS}) { nodes {
  ... on IssueFieldCommon { name dataType } ... on IssueFieldSingleSelect { id options { id name color description } } } }`;

/** The single-select issue fields from a GraphQL `issueFields` connection. */
function toIssueFields(nodes: GqlIssueField[] | undefined): IssueFieldInfo[] {
  return (nodes ?? [])
    .filter(n => n.dataType === "SINGLE_SELECT" && n.id && n.name)
    .map(n => ({ id: n.id as string, name: n.name as string, options: n.options ?? [] }));
}

/** Builds the issue fragment for the detected features. */
function issueFields(f: Features): string {
  const link = `(first: ${MAX_LINKS}) { nodes { number state } }`;
  return [
    "id number title body state url",
    `labels(first: ${MAX_LABELS}) { nodes { name } }`,
    f.issueTypes.length > 0 ? "issueType { name }" : "",
    f.subIssues ? `parent { number } subIssues${link}` : "",
    f.dependencies ? `blockedBy${link} blocking${link}` : "",
    f.issueFieldsSupported ? ISSUE_FIELD_VALUES : "",
    FIELD_VALUES,
  ].join("\n");
}

function toLinks(nodes: GqlLink[] | undefined): Link[] {
  return (nodes ?? []).map(n => ({ number: n.number, open: n.state === "OPEN" }));
}

/** Parses the fallback body lines (`Parent: #n`, `Blocked by #n`, `- [ ] #n`). */
export function parseBodyLinks(body: string): { parent?: number; blockedBy: number[]; children: number[] } {
  const parent = PARENT_LINE.exec(body)?.[1];
  const blockedBy = [...body.matchAll(BLOCKED_BY_LINE)].flatMap(m => [...m[1].matchAll(/#(\d+)/g)].map(n => +n[1]));
  const children = [...body.matchAll(TASK_LIST_LINE)].map(m => +m[1]);
  return { parent: parent ? +parent : undefined, blockedBy, children };
}

/** Converts a GraphQL issue into a RawIssue, applying the body-line fallbacks for missing features. */
export function toRawIssue(i: GqlIssue, f: Features): RawIssue {
  const boards: Record<string, Record<string, string>> = {};
  for (const item of i.projectItems.nodes) {
    const values: Record<string, string> = {};
    for (const v of item.fieldValues.nodes) {
      const field = (v.field as { name?: string } | undefined)?.name;
      const value = (v.name ?? v.text) as string | undefined;
      if (field && value !== undefined) values[field] = value;
    }
    boards[item.project.title] = values;
  }
  const issueFields: Record<string, string> = {};
  for (const v of i.issueFieldValues?.nodes ?? []) {
    const field = (v.field as { name?: string } | undefined)?.name;
    const value = (v.name ?? v.value) as string | undefined;
    if (field && value !== undefined && value !== null) issueFields[field] = String(value);
  }
  const fallback = parseBodyLinks(i.body ?? "");
  return {
    nodeId: i.id,
    number: i.number,
    title: i.title,
    body: i.body ?? "",
    open: i.state === "OPEN",
    url: i.url,
    labels: i.labels.nodes.map(l => l.name),
    issueType: i.issueType?.name,
    parent: f.subIssues ? i.parent?.number : fallback.parent,
    children: f.subIssues ? toLinks(i.subIssues?.nodes) : fallback.children.map(number => ({ number })),
    blockedBy: f.dependencies ? toLinks(i.blockedBy?.nodes) : fallback.blockedBy.map(number => ({ number })),
    blocking: f.dependencies ? toLinks(i.blocking?.nodes) : [],
    boards,
    issueFields,
  };
}

/**
 * Whether an error is GitHub's rate limit (REST 403/429 or a GraphQL "API rate limit" error): the run should wait
 * for the next one (the nightly sweep catches up), not fail.
 */
export function isRateLimit(e: unknown): boolean {
  const err = e as { status?: number; message?: string } | undefined;
  const text = String(err?.message ?? e ?? "");
  return (
    /\b(?:secondary |API )?rate limit\b/i.test(text) && (err?.status === undefined || [403, 429].includes(err.status))
  );
}

/** Appends a line to a body unless an equal line is already there. */
export function appendLine(body: string, line: string): string {
  if (body.split(/\r?\n/).some(l => l.trim() === line)) return body;
  return body.trimEnd() + (body.trim() ? "\n\n" : "") + line + "\n";
}

/**
 * The Octokit implementation of PlanApi: REST for issues, comments and labels; GraphQL for Projects v2, issue fields,
 * sub-issues, dependencies and issue types (all native when GitHub has them; body lines or boards otherwise).
 */
export class GitHubApi implements PlanApi {
  private readonly owner: string;
  private readonly repo: string;
  private featureCache?: Features;
  private projectCache?: Project[];

  /**
   * @param octokit An authenticated Octokit (or a mock with `graphql` and `request`)
   * @param repository "owner/name"
   * @param projectOwner The login owning the boards (organization or user)
   */
  constructor(
    private readonly octokit: OctokitLike,
    repository: string,
    private readonly projectOwner: string
  ) {
    [this.owner, this.repo] = repository.split("/");
  }

  async features(): Promise<Features> {
    if (this.featureCache) return this.featureCache;
    const data = await this.octokit.graphql<{
      __type: { fields: { name: string }[] };
      repo?: { fields: { name: string }[] } | null;
      repository: { owner?: { __typename: string }; issueTypes?: { nodes: { name: string }[] } | null };
    }>(
      `query($owner: String!, $name: String!) { __type(name: "Issue") { fields { name } }
        repo: __type(name: "Repository") { fields { name } }
        repository(owner: $owner, name: $name) { owner { __typename } issueTypes(first: 50) { nodes { name } } } }`,
      { owner: this.owner, name: this.repo }
    );
    const names = new Set(data.__type.fields.map(f => f.name));
    const supported =
      names.has("issueFieldValues") &&
      (data.repo?.fields ?? []).some(f => f.name === "issueFields") &&
      data.repository.owner?.__typename === "Organization";
    this.featureCache = {
      subIssues: names.has("subIssues") && names.has("parent"),
      dependencies: names.has("blockedBy") && names.has("blocking"),
      issueTypes: (data.repository.issueTypes?.nodes ?? []).map(t => t.name),
      issueFieldsSupported: supported,
      issueFields: supported ? await this.loadIssueFields() : [],
    };
    return this.featureCache;
  }

  /** The repository's issue fields (its organization's). */
  private async loadIssueFields(): Promise<IssueFieldInfo[]> {
    const data = await this.octokit.graphql<{ repository: { issueFields: { nodes: GqlIssueField[] } | null } }>(
      `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${ISSUE_FIELDS} } }`,
      { owner: this.owner, name: this.repo }
    );
    return toIssueFields(data.repository.issueFields?.nodes);
  }

  async listIssues(includeClosed: boolean): Promise<RawIssue[]> {
    const f = await this.features();
    const issues: RawIssue[] = [];
    let after: string | null = null;
    do {
      const data: {
        repository: { issues: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: GqlIssue[] } };
      } = await this.octokit.graphql(
        `query($owner: String!, $name: String!, $states: [IssueState!], $after: String) {
          repository(owner: $owner, name: $name) {
            issues(first: ${PAGE_SIZE}, states: $states, after: $after, orderBy: { field: CREATED_AT, direction: ASC }) {
              pageInfo { hasNextPage endCursor } nodes { ${issueFields(f)} } } } }`,
        { owner: this.owner, name: this.repo, states: includeClosed ? ["OPEN", "CLOSED"] : ["OPEN"], after }
      );
      const page = data.repository.issues;
      issues.push(...page.nodes.map(i => toRawIssue(i, f)));
      after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (after);
    return issues;
  }

  async getIssue(number: number): Promise<RawIssue | undefined> {
    const f = await this.features();
    try {
      const data = await this.octokit.graphql<{ repository: { issue: GqlIssue | null } }>(
        `query($owner: String!, $name: String!, $number: Int!) {
          repository(owner: $owner, name: $name) { issue(number: $number) { ${issueFields(f)} } } }`,
        { owner: this.owner, name: this.repo, number }
      );
      return data.repository.issue ? toRawIssue(data.repository.issue, f) : undefined;
    } catch (_e) {
      return undefined;
    }
  }

  async createIssue(input: NewIssue): Promise<RawIssue> {
    const { data } = await this.octokit.request("POST /repos/{owner}/{repo}/issues", {
      owner: this.owner,
      repo: this.repo,
      title: input.title,
      body: input.body,
      labels: input.labels,
      ...(input.issueType ? { type: input.issueType } : {}),
    });
    const d = data as { node_id: string; number: number; title: string; body: string | null; html_url: string };
    return {
      nodeId: d.node_id,
      number: d.number,
      title: d.title,
      body: d.body ?? "",
      open: true,
      url: d.html_url,
      labels: input.labels,
      issueType: input.issueType,
      children: [],
      blockedBy: [],
      blocking: [],
      boards: {},
      issueFields: {},
    };
  }

  async updateBody(number: number, body: string): Promise<void> {
    await this.octokit.request("PATCH /repos/{owner}/{repo}/issues/{issue_number}", {
      owner: this.owner,
      repo: this.repo,
      issue_number: number,
      body,
    });
  }

  async updateIssue(number: number, update: IssueUpdate): Promise<void> {
    await this.octokit.request("PATCH /repos/{owner}/{repo}/issues/{issue_number}", {
      owner: this.owner,
      repo: this.repo,
      issue_number: number,
      ...(update.title !== undefined ? { title: update.title } : {}),
      ...(update.body !== undefined ? { body: update.body } : {}),
      ...(update.issueType !== undefined ? { type: update.issueType } : {}),
    });
  }

  async removeLabel(number: number, label: string): Promise<void> {
    try {
      await this.octokit.request("DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}", {
        owner: this.owner,
        repo: this.repo,
        issue_number: number,
        name: label,
      });
    } catch (e) {
      if ((e as { status?: number }).status !== 404) throw e;
    }
  }

  async listComments(number: number): Promise<IssueComment[]> {
    const out: IssueComment[] = [];
    for (let page = 1; ; page++) {
      const { data } = await this.octokit.request("GET /repos/{owner}/{repo}/issues/{issue_number}/comments", {
        owner: this.owner,
        repo: this.repo,
        issue_number: number,
        per_page: 100,
        page,
      });
      const list = data as { id: number; body?: string | null }[];
      out.push(...list.map(c => ({ id: c.id, body: c.body ?? "" })));
      if (list.length < 100) return out;
    }
  }

  async updateComment(id: number, body: string): Promise<void> {
    await this.octokit.request("PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}", {
      owner: this.owner,
      repo: this.repo,
      comment_id: id,
      body,
    });
  }

  async addLabels(number: number, labels: string[]): Promise<void> {
    if (labels.length === 0) return;
    await this.octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/labels", {
      owner: this.owner,
      repo: this.repo,
      issue_number: number,
      labels,
    });
  }

  async comment(number: number, body: string): Promise<void> {
    await this.octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
      owner: this.owner,
      repo: this.repo,
      issue_number: number,
      body,
    });
  }

  async setOpen(number: number, open: boolean): Promise<void> {
    await this.octokit.request("PATCH /repos/{owner}/{repo}/issues/{issue_number}", {
      owner: this.owner,
      repo: this.repo,
      issue_number: number,
      state: open ? "open" : "closed",
      ...(open ? {} : { state_reason: "completed" }),
    });
  }

  async addSubIssue(parent: RawIssue, child: RawIssue): Promise<void> {
    if ((await this.features()).subIssues) {
      await this.octokit.graphql(
        `mutation($issueId: ID!, $subIssueId: ID!) {
          addSubIssue(input: { issueId: $issueId, subIssueId: $subIssueId, replaceParent: true }) { issue { number } } }`,
        { issueId: parent.nodeId, subIssueId: child.nodeId }
      );
      return;
    }
    await this.updateBody(child.number, appendLine(child.body, `Parent: #${parent.number}`));
    await this.updateBody(parent.number, appendLine(parent.body, `- [ ] #${child.number}`));
  }

  async addBlockedBy(issue: RawIssue, blocker: RawIssue): Promise<void> {
    if ((await this.features()).dependencies) {
      await this.octokit.graphql(
        `mutation($issueId: ID!, $blockingIssueId: ID!) {
          addBlockedBy(input: { issueId: $issueId, blockingIssueId: $blockingIssueId }) { issue { number } } }`,
        { issueId: issue.nodeId, blockingIssueId: blocker.nodeId }
      );
      return;
    }
    await this.updateBody(issue.number, appendLine(issue.body, `Blocked by #${blocker.number}`));
  }

  /** Loads (once) the owner's boards with their fields. */
  private async projects(): Promise<Project[]> {
    if (this.projectCache) return this.projectCache;
    const data = await this.octokit.graphql<{
      repositoryOwner: { projectsV2: { nodes: Project[] } } | null;
    }>(
      `query($login: String!) { repositoryOwner(login: $login) { ... on ProjectV2Owner {
        projectsV2(first: ${MAX_PROJECTS}) { nodes { ${PROJECT_FIELDS} } } } } }`,
      { login: this.projectOwner }
    );
    this.projectCache = data.repositoryOwner?.projectsV2.nodes ?? [];
    return this.projectCache;
  }

  private async findProject(board: BoardConfig): Promise<Project | undefined> {
    const all = await this.projects();
    return all.find(p => (board.number !== undefined ? p.number === board.number : p.title === board.title));
  }

  async setFields(issue: RawIssue, board: BoardConfig, values: Record<string, string>): Promise<void> {
    const project = await this.findProject(board);
    if (!project) throw new Error(`board "${board.title}" not found: run plan-me init`);
    const added = await this.octokit.graphql<{ addProjectV2ItemById: { item: { id: string } } }>(
      `mutation($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) { item { id } } }`,
      { projectId: project.id, contentId: issue.nodeId }
    );
    for (const [name, value] of Object.entries(values)) {
      const field = project.fields.nodes.find(f => f.name === name);
      if (!field) throw new Error(`board "${project.title}" has no field "${name}": run plan-me init`);
      let fieldValue: Record<string, string>;
      if (field.options) {
        const option = field.options.find(o => o.name === value);
        if (!option) throw new Error(`field "${name}" has no option "${value}": run plan-me init`);
        fieldValue = { singleSelectOptionId: option.id };
      } else {
        fieldValue = { text: value };
      }
      await this.octokit.graphql(
        `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
          updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
            value: $value }) { projectV2Item { id } } }`,
        { projectId: project.id, itemId: added.addProjectV2ItemById.item.id, fieldId: field.id, value: fieldValue }
      );
    }
  }

  async setIssueFields(issue: RawIssue, values: Record<string, string>): Promise<void> {
    const { issueFields } = await this.features();
    const inputs = Object.entries(values).map(([name, value]) => {
      const field = issueFields.find(f => f.name === name);
      if (!field) throw new Error(`the organization has no issue field "${name}": run plan-me init`);
      const option = field.options.find(o => o.name === value);
      if (!option) throw new Error(`issue field "${name}" has no option "${value}": run plan-me init`);
      return { fieldId: field.id, singleSelectOptionId: option.id };
    });
    if (inputs.length === 0) return;
    await this.octokit.graphql(
      `mutation($issueId: ID!, $issueFields: [IssueFieldCreateOrUpdateInput!]!) {
        setIssueFieldValue(input: { issueId: $issueId, issueFields: $issueFields }) { issue { number } } }`,
      { issueId: issue.nodeId, issueFields: inputs }
    );
  }

  async ensureIssueFields(fields: FieldSpec[], dryRun: boolean): Promise<string[]> {
    const { issueFields, issueFieldsSupported } = await this.features();
    if (!issueFieldsSupported) return [];
    const actions: string[] = [];
    const where = `on organization "${this.owner}"`;
    for (const spec of fields) {
      const field = issueFields.find(f => f.name === spec.name);
      if (!field) {
        actions.push(`create issue field "${spec.name}" ${where}`);
        if (dryRun) continue;
        const { organization } = await this.octokit.graphql<{ organization: { id: string } }>(
          `query($login: String!) { organization(login: $login) { id } }`,
          { login: this.owner }
        );
        await this.octokit.graphql(
          `mutation($input: CreateIssueFieldInput!) { createIssueField(input: $input) { clientMutationId } }`,
          {
            input: {
              ownerId: organization.id,
              name: spec.name,
              dataType: "SINGLE_SELECT",
              visibility: "ALL",
              options: spec.options.map((name, i) => ({ name, color: DEFAULT_OPTION_COLOR, priority: i + 1 })),
            },
          }
        );
        continue;
      }
      const missing = spec.options.filter(o => !field.options.some(h => h.name === o));
      if (missing.length === 0) continue;
      actions.push(`add options ${missing.join(", ")} to issue field "${spec.name}" ${where}`);
      if (dryRun) continue;
      const options = [
        ...field.options.map(o => ({
          name: o.name,
          color: o.color ?? DEFAULT_OPTION_COLOR,
          description: o.description,
        })),
        ...missing.map(name => ({ name, color: DEFAULT_OPTION_COLOR, description: "" })),
      ].map((o, i) => ({ ...o, description: o.description ?? "", priority: i + 1 }));
      await this.octokit.graphql(
        `mutation($input: UpdateIssueFieldInput!) { updateIssueField(input: $input) { clientMutationId } }`,
        { input: { id: field.id, options } }
      );
    }
    if (!dryRun && actions.length > 0) this.featureCache = undefined;
    return actions;
  }

  async ensureLabels(labels: LabelConfig[], dryRun: boolean): Promise<string[]> {
    const existing = new Set<string>();
    for (let page = 1; ; page++) {
      const { data } = await this.octokit.request("GET /repos/{owner}/{repo}/labels", {
        owner: this.owner,
        repo: this.repo,
        per_page: 100,
        page,
      });
      const names = (data as { name: string }[]).map(l => l.name.toLowerCase());
      names.forEach(n => existing.add(n));
      if (names.length < 100) break;
    }
    const actions: string[] = [];
    for (const label of labels) {
      if (existing.has(label.name.toLowerCase())) continue;
      actions.push(`create label ${label.name}`);
      if (dryRun) continue;
      await this.octokit.request("POST /repos/{owner}/{repo}/labels", {
        owner: this.owner,
        repo: this.repo,
        name: label.name,
        color: label.color ?? DEFAULT_LABEL_COLOR,
        description: label.description ?? "",
      });
    }
    return actions;
  }

  async ensureBoard(board: BoardConfig, fields: FieldSpec[], dryRun: boolean): Promise<string[]> {
    const actions: string[] = [];
    let project = await this.findProject(board);
    if (!project) {
      actions.push(`create board "${board.title}"`);
      if (dryRun) return [...actions, ...fields.map(f => `create field "${f.name}" on "${board.title}"`)];
      project = await this.createProject(board.title);
    }
    for (const spec of fields) {
      const field = project.fields.nodes.find(f => f.name === spec.name);
      const where = `on "${project.title}"`;
      if (!field) {
        actions.push(`create field "${spec.name}" ${where}`);
        if (dryRun) continue;
        await this.octokit.graphql(
          `mutation($input: CreateProjectV2FieldInput!) { createProjectV2Field(input: $input) {
            projectV2Field { ... on ProjectV2FieldCommon { id } } } }`,
          {
            input: {
              projectId: project.id,
              name: spec.name,
              dataType: spec.options.length > 0 ? "SINGLE_SELECT" : "TEXT",
              ...(spec.options.length > 0
                ? {
                    singleSelectOptions: spec.options.map(name => ({
                      name,
                      color: DEFAULT_OPTION_COLOR,
                      description: "",
                    })),
                  }
                : {}),
            },
          }
        );
        continue;
      }
      const have = field.options ?? [];
      const missing = spec.options.filter(o => !have.some(h => h.name === o));
      if (missing.length === 0) continue;
      actions.push(`add options ${missing.join(", ")} to "${spec.name}" ${where}`);
      if (dryRun) continue;
      await this.octokit.graphql(
        `mutation($input: UpdateProjectV2FieldInput!) { updateProjectV2Field(input: $input) {
          projectV2Field { ... on ProjectV2FieldCommon { id } } } }`,
        {
          input: {
            fieldId: field.id,
            singleSelectOptions: [
              ...have.map(o => ({ id: o.id, name: o.name, color: o.color, description: o.description })),
              ...missing.map(name => ({ name, color: DEFAULT_OPTION_COLOR, description: "" })),
            ],
          },
        }
      );
    }
    if (!dryRun && actions.length > 0) this.projectCache = undefined;
    return actions;
  }

  /** Creates a board owned by the project owner, linked to the repository. */
  private async createProject(title: string): Promise<Project> {
    const ids = await this.octokit.graphql<{ repositoryOwner: { id: string }; repository: { id: string } }>(
      `query($login: String!, $owner: String!, $name: String!) { repositoryOwner(login: $login) { id }
        repository(owner: $owner, name: $name) { id } }`,
      { login: this.projectOwner, owner: this.owner, name: this.repo }
    );
    const data = await this.octokit.graphql<{ createProjectV2: { projectV2: Project } }>(
      `mutation($ownerId: ID!, $repositoryId: ID!, $title: String!) {
        createProjectV2(input: { ownerId: $ownerId, repositoryId: $repositoryId, title: $title }) {
          projectV2 { ${PROJECT_FIELDS} } } }`,
      { ownerId: ids.repositoryOwner.id, repositoryId: ids.repository.id, title }
    );
    this.projectCache = undefined;
    return data.createProjectV2.projectV2;
  }
}
