/**
 * Jira Cloud REST v3 client, speaking OAuth 2.0 (3LO).
 *
 * Requests go to https://api.atlassian.com/ex/jira/{cloudId} rather than the site
 * URL directly, which is what the 3LO gateway requires. The /rest/api/3/... paths
 * below are byte-identical to the Basic-auth versions they replaced — only the
 * transport changed.
 */
import { JIRA_API_BASE } from "./auth/config.js";
import { textToAdf } from "./adf.js";

export interface JiraClientOptions {
  cloudId: string;
  /** Resolved per request, so a mid-session token refresh is picked up. */
  getAccessToken: () => Promise<string> | string;
  /** Invoked once on a 401 to force a refresh before a single retry. */
  onUnauthorized?: () => Promise<string | null>;
}

/** A transition the workflow doesn't offer — the user's request, not Jira's failure. */
export class JiraTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JiraTransitionError";
  }
}

/** "In-Progress", "in progress", "Đang làm " → comparable keys. */
export function foldName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export class JiraApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly retryAfter?: string
  ) {
    super(`Jira API error ${status}`);
    this.name = "JiraApiError";
  }

  /**
   * The app lacks an OAuth scope — not that the user lacks a Jira permission, and
   * not that the session died. Retrying loops forever, and logging in again
   * yields a token with the same scopes. Atlassian reports it two ways: a 403
   * from Jira itself, and a 401 from the api.atlassian.com gateway (seen on
   * GET /group/member, which needs manage:jira-configuration).
   */
  get scopeProblem(): boolean {
    return (
      (this.status === 403 && /OAuth 2\.0 is not enabled for this method/i.test(this.body)) ||
      (this.status === 401 && /scope does not match/i.test(this.body))
    );
  }

  /**
   * Jira refusing a project-admin endpoint (e.g. GET /project/{key}/role) to a
   * user without Administer Projects. Jira sends this as a 401, not a 403 — seen
   * in practice, not documented — so it looks exactly like a dead session to
   * anything that only reads the status. It is a permission refusal: logging in
   * again changes nothing.
   */
  get configRefused(): boolean {
    return this.status === 401 && /cannot edit the configuration/i.test(this.body);
  }

  /** Jira's own message, extracted from errorMessages/errors, for showing to users. */
  get summary(): string {
    try {
      const parsed = JSON.parse(this.body);
      const messages: string[] = [
        ...(Array.isArray(parsed.errorMessages) ? parsed.errorMessages : []),
        ...(parsed.errors && typeof parsed.errors === "object" ? Object.values<string>(parsed.errors) : []),
      ];
      return messages.join(" ").trim();
    } catch {
      return "";
    }
  }
}

/** One entry in a project role: either a person, or a group standing for many. */
export interface RoleActor {
  type: string;
  displayName?: string;
  avatarUrl?: string;
  actorUser?: { accountId: string };
  actorGroup?: { groupId?: string; name?: string; displayName?: string };
}

/** The user shape Jira returns from user and group endpoints alike. */
export interface JiraUserLike {
  accountId: string;
  displayName: string;
  avatarUrls?: Record<string, string>;
  active?: boolean;
  /** "atlassian" for a person; "app" for a bot, which is never a team member. */
  accountType?: string;
}

const RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_MAX_WAIT_MS = 5000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class JiraClient {
  constructor(private readonly opts: JiraClientOptions) {}

  private async request<T>(path: string, init: RequestInit = {}, isRetry = false): Promise<T> {
    const token = await this.opts.getAccessToken();
    // A multipart upload must let fetch write its own Content-Type, boundary included.
    const multipart = typeof FormData !== "undefined" && init.body instanceof FormData;
    const res = await fetch(`${JIRA_API_BASE}/ex/jira/${this.opts.cloudId}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(multipart ? {} : { "Content-Type": "application/json" }),
        ...(init.headers ?? {}),
      },
    });

    if (res.status === 401 && !isRetry && this.opts.onUnauthorized) {
      // Usually just an expired hour, not bad credentials. One retry only — and
      // never for 403, which means a missing scope and would loop.
      const refreshed = await this.opts.onUnauthorized();
      if (refreshed) return this.request<T>(path, init, true);
    }

    if (res.status === 429) {
      const retryAfter = res.headers.get("retry-after") ?? undefined;
      const attempt = (init as any).__rateLimitAttempt ?? 0;
      if (attempt < RATE_LIMIT_RETRIES) {
        const waitMs = Math.min(
          retryAfter ? Number(retryAfter) * 1000 || 1000 : 1000 * 2 ** attempt,
          RATE_LIMIT_MAX_WAIT_MS
        );
        await sleep(waitMs);
        return this.request<T>(path, { ...init, __rateLimitAttempt: attempt + 1 } as RequestInit, isRetry);
      }
      throw new JiraApiError(429, await res.text().catch(() => ""), retryAfter);
    }

    if (!res.ok) {
      throw new JiraApiError(res.status, await res.text().catch(() => ""));
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async searchIssues(jql: string, fields: string[]): Promise<any[]> {
    const issues: any[] = [];
    let nextPageToken: string | undefined;
    do {
      const body: Record<string, unknown> = { jql, fields, maxResults: 100 };
      if (nextPageToken) body.nextPageToken = nextPageToken;
      const page = await this.request<{ issues: any[]; nextPageToken?: string }>(
        "/rest/api/3/search/jql",
        { method: "POST", body: JSON.stringify(body) }
      );
      issues.push(...page.issues);
      nextPageToken = page.nextPageToken;
    } while (nextPageToken);
    return issues;
  }

  async getIssue(key: string): Promise<any> {
    return this.request(`/rest/api/3/issue/${encodeURIComponent(key)}`);
  }

  async updateIssueFields(key: string, fields: Record<string, unknown>): Promise<void> {
    await this.request(`/rest/api/3/issue/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify({ fields }),
    });
  }

  async assignIssue(key: string, accountId: string | null): Promise<void> {
    await this.request(`/rest/api/3/issue/${encodeURIComponent(key)}/assignee`, {
      method: "PUT",
      body: JSON.stringify({ accountId }),
    });
  }

  async getTransitions(
    key: string
  ): Promise<Array<{ id: string; name: string; to?: { id: string; name: string; statusCategory?: { key: string } } }>> {
    const res = await this.request<{
      transitions: Array<{ id: string; name: string; to?: { id: string; name: string; statusCategory?: { key: string } } }>;
    }>(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`);
    return res.transitions;
  }

  async transitionIssueById(key: string, transitionId: string): Promise<void> {
    await this.request(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, {
      method: "POST",
      body: JSON.stringify({ transition: { id: transitionId } }),
    });
  }

  /** Every status each issue type of the project can be in — the status board's columns. */
  async getProjectStatuses(
    projectKey: string
  ): Promise<Array<{ name: string; statuses: Array<{ id: string; name: string; statusCategory?: { key: string } }> }>> {
    return this.request(`/rest/api/3/project/${encodeURIComponent(projectKey)}/statuses`);
  }

  /* ---------------------------------------------------------------------------
   * Jira Software (Agile) API. Needs the granular AGILE_SCOPES in auth/config.ts;
   * without them every call here is a 401 "scope does not match", which
   * JiraApiError.scopeProblem recognises and boardService turns into a fallback.
   * ------------------------------------------------------------------------- */

  /**
   * A saved filter, the thing every board (Scrum or Kanban) is backed by. Jira
   * has no "create board for this project" shortcut — creating one is always
   * two calls, filter then board — and `ORDER BY Rank` is what lets the new
   * board's issues be reordered at all; a board on an un-ranked filter can
   * never be dragged into an order (Atlassian's own note on the endpoint).
   *
   * This is the *platform* filter API (`/rest/api/2/filter`, no v3 equivalent
   * exists) and needs only the classic `write:jira-work` scope already
   * requested — unlike the board it backs, it does not need JIRA_AGILE.
   */
  async createFilter(name: string, jql: string): Promise<{ id: string }> {
    return this.request(`/rest/api/2/filter`, { method: "POST", body: JSON.stringify({ name, jql }) });
  }

  /** Needs `write:board-scope:jira-software` — see AGILE_SCOPES, behind JIRA_AGILE. */
  async createBoard(input: { name: string; type: "scrum" | "kanban"; filterId: string; projectKey: string }): Promise<{ id: number; name: string; type: string }> {
    return this.request(`/rest/agile/1.0/board`, {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        type: input.type,
        filterId: Number(input.filterId),
        location: { type: "project", projectKeyOrId: input.projectKey },
      }),
    });
  }

  async listBoards(projectKey: string): Promise<Array<{ id: number; name: string; type: string }>> {
    const out: Array<{ id: number; name: string; type: string }> = [];
    let startAt = 0;
    for (let page = 0; page < 10; page++) {
      const res = await this.request<{ values: Array<{ id: number; name: string; type: string }>; isLast: boolean }>(
        `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(projectKey)}&maxResults=50&startAt=${startAt}`
      );
      out.push(...(res.values ?? []));
      if (res.isLast || (res.values?.length ?? 0) === 0) break;
      startAt += res.values.length;
    }
    return out;
  }

  async getBoardConfiguration(boardId: number): Promise<{
    columnConfig?: { columns?: Array<{ name: string; statuses?: Array<{ id: string }>; min?: number; max?: number }>; constraintType?: string };
    estimation?: { type?: string; field?: { fieldId?: string; displayName?: string } };
    ranking?: { rankCustomFieldId?: number };
  }> {
    return this.request(`/rest/agile/1.0/board/${boardId}/configuration`);
  }

  async listSprints(boardId: number, states: string): Promise<any[]> {
    const out: any[] = [];
    let startAt = 0;
    for (let page = 0; page < 20; page++) {
      const res = await this.request<{ values: any[]; isLast: boolean }>(
        `/rest/agile/1.0/board/${boardId}/sprint?state=${encodeURIComponent(states)}&maxResults=50&startAt=${startAt}`
      );
      out.push(...(res.values ?? []));
      if (res.isLast || (res.values?.length ?? 0) === 0) break;
      startAt += res.values.length;
    }
    return out;
  }

  async getSprint(sprintId: number): Promise<any> {
    return this.request(`/rest/agile/1.0/sprint/${sprintId}`);
  }

  /**
   * Issues on a board, in the board's rank order, narrowed by `jql` (AND-ed with
   * the board's own filter). The agile endpoints add sprint, closedSprints and
   * flagged to the requested fields. Capped at `limit` so a board with years of
   * history can't turn one page load into dozens of round trips.
   */
  async getBoardIssues(boardId: number, jql: string, fields: string[], limit = 1000): Promise<any[]> {
    const out: any[] = [];
    let startAt = 0;
    while (out.length < limit) {
      const res = await this.request<{ issues: any[]; total: number }>(
        `/rest/agile/1.0/board/${boardId}/issue?jql=${encodeURIComponent(jql)}` +
          `&fields=${encodeURIComponent(fields.join(","))}&maxResults=100&startAt=${startAt}`
      );
      const batch = res.issues ?? [];
      out.push(...batch);
      startAt += batch.length;
      if (batch.length === 0 || startAt >= (res.total ?? 0)) break;
    }
    return out.slice(0, limit);
  }

  async createSprint(input: { name: string; originBoardId: number; goal?: string; startDate?: string; endDate?: string }): Promise<any> {
    return this.request(`/rest/agile/1.0/sprint`, { method: "POST", body: JSON.stringify(input) });
  }

  /** Partial update. state "active" starts a future sprint (needs dates); "closed" completes an active one. */
  async updateSprint(sprintId: number, patch: Record<string, unknown>): Promise<any> {
    return this.request(`/rest/agile/1.0/sprint/${sprintId}`, { method: "POST", body: JSON.stringify(patch) });
  }

  /** At most 50 per call — Jira's limit; callers chunk. */
  async moveIssuesToSprint(sprintId: number, issues: string[], rank?: { before?: string; after?: string }): Promise<void> {
    await this.request(`/rest/agile/1.0/sprint/${sprintId}/issue`, {
      method: "POST",
      body: JSON.stringify({
        issues,
        ...(rank?.before ? { rankBeforeIssue: rank.before } : {}),
        ...(rank?.after ? { rankAfterIssue: rank.after } : {}),
      }),
    });
  }

  async moveIssuesToBacklog(issues: string[]): Promise<void> {
    await this.request(`/rest/agile/1.0/backlog/issue`, { method: "POST", body: JSON.stringify({ issues }) });
  }

  async rankIssues(issues: string[], rank: { before?: string; after?: string }): Promise<void> {
    await this.request(`/rest/agile/1.0/issue/rank`, {
      method: "PUT",
      body: JSON.stringify({
        issues,
        ...(rank.before ? { rankBeforeIssue: rank.before } : { rankAfterIssue: rank.after }),
      }),
    });
  }

  /**
   * Writes the board's own estimation field, whatever it is on this site
   * ("Story Points", team-managed "Story point estimate", or time). The agile
   * endpoint resolves which field from the board, which is why this is used
   * instead of guessing a customfield id for PUT /issue.
   */
  async setEstimation(key: string, boardId: number, value: string): Promise<void> {
    await this.request(`/rest/agile/1.0/issue/${encodeURIComponent(key)}/estimation?boardId=${boardId}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    });
  }

  /**
   * Move an issue by transition id, transition name or target status name.
   *
   * Matching only the transition *name* exactly was BUG-05: a workflow's
   * transitions are named by whoever drew it ("Start progress", "In-Progress",
   * "Đang làm"), so "In Progress" failed on a site whose status is "In-Progress"
   * even though Jira's own UI moved the same issue fine. Names are compared with
   * case, spacing, punctuation and diacritics folded away, and the target status
   * counts as much as the transition's own label.
   */
  async transitionIssue(key: string, wanted: string): Promise<{ id: string; name: string; toStatusName: string | null }> {
    const transitions = await this.getTransitions(key);
    const want = foldName(wanted);
    const match =
      transitions.find((t) => t.id === wanted) ??
      transitions.find((t) => foldName(t.to?.name ?? "") === want) ??
      transitions.find((t) => foldName(t.name) === want);
    if (!match) {
      const allowed = [...new Set(transitions.map((t) => t.to?.name ?? t.name))];
      throw new JiraTransitionError(
        `Quy trình của ${key} không cho chuyển sang "${wanted}" từ trạng thái hiện tại. ` +
          (allowed.length ? `Có thể chuyển sang: ${allowed.join(", ")}.` : "Không có bước chuyển nào khả dụng.")
      );
    }
    await this.transitionIssueById(key, match.id);
    return { id: match.id, name: match.name, toStatusName: match.to?.name ?? null };
  }

  /* --------------------------------------------- attachments and web links */

  /**
   * Multipart upload to an existing issue. `X-Atlassian-Token: no-check` is
   * mandatory — without it Jira rejects the request as a possible XSRF.
   * Covered by the classic `write:jira-work` scope already requested.
   */
  async addAttachment(key: string, file: { name: string; type: string; data: Buffer }): Promise<Array<{ id: string; filename: string; size: number }>> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(file.data)], { type: file.type || "application/octet-stream" }), file.name);
    return this.request(`/rest/api/3/issue/${encodeURIComponent(key)}/attachments`, {
      method: "POST",
      body: form,
      headers: { "X-Atlassian-Token": "no-check" },
    });
  }

  async getAttachments(key: string): Promise<Array<{ id: string; filename: string; size: number; mimeType: string; created: string; author?: { displayName?: string } }>> {
    const issue = await this.request<any>(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=attachment`);
    return issue.fields?.attachment ?? [];
  }

  /** A "web link" on the issue — what Jira's own "Add link → Web link" creates. */
  async addRemoteLink(key: string, url: string, title: string): Promise<{ id: number }> {
    return this.request(`/rest/api/3/issue/${encodeURIComponent(key)}/remotelink`, {
      method: "POST",
      body: JSON.stringify({ object: { url, title } }),
    });
  }

  async getRemoteLinks(key: string): Promise<Array<{ id: number; object?: { url?: string; title?: string } }>> {
    return this.request(`/rest/api/3/issue/${encodeURIComponent(key)}/remotelink`);
  }

  /* --------------------------------------------------------------- worklogs */

  /** All worklogs on one issue started inside [afterMs, beforeMs), paged. */
  async getWorklogs(key: string, afterMs: number, beforeMs: number): Promise<any[]> {
    const out: any[] = [];
    let startAt = 0;
    for (let page = 0; page < 20; page++) {
      const res = await this.request<{ worklogs: any[]; total: number }>(
        `/rest/api/3/issue/${encodeURIComponent(key)}/worklog?startedAfter=${afterMs}&startedBefore=${beforeMs}` +
          `&maxResults=1000&startAt=${startAt}`
      );
      const batch = res.worklogs ?? [];
      out.push(...batch);
      startAt += batch.length;
      if (batch.length === 0 || startAt >= (res.total ?? 0)) break;
    }
    return out;
  }

  /**
   * `started` must be Jira's own format, `yyyy-MM-dd'T'HH:mm:ss.SSSZ` with the
   * offset written +0700 (no colon) — an ISO string with `Z` or `+07:00` is a 400.
   * adjustEstimate=leave keeps the original estimate a plan, not a countdown.
   */
  async addWorklog(key: string, input: { seconds: number; started: string; comment?: string | null }): Promise<any> {
    return this.request(`/rest/api/3/issue/${encodeURIComponent(key)}/worklog?adjustEstimate=leave`, {
      method: "POST",
      body: JSON.stringify({
        timeSpentSeconds: input.seconds,
        started: input.started,
        ...(input.comment ? { comment: textToAdf(input.comment) } : {}),
      }),
    });
  }

  async deleteWorklog(key: string, worklogId: string): Promise<void> {
    await this.request(
      `/rest/api/3/issue/${encodeURIComponent(key)}/worklog/${encodeURIComponent(worklogId)}?adjustEstimate=leave`,
      { method: "DELETE" }
    );
  }

  async createIssue(input: {
    projectKey: string;
    issueTypeName: string;
    summary: string;
    description?: string | null;
    parentKey?: string | null;
    dueDate?: string | null;
    startDate?: string | null;
    startDateFieldId?: string | null;
    assigneeAccountId?: string | null;
  }): Promise<{ id: string; key: string }> {
    const fields: Record<string, unknown> = {
      project: { key: input.projectKey },
      issuetype: { name: input.issueTypeName },
      summary: input.summary,
    };
    if (input.parentKey) fields.parent = { key: input.parentKey };
    if (input.description) fields.description = textToAdf(input.description);
    if (input.dueDate) fields.duedate = input.dueDate;
    if (input.startDate && input.startDateFieldId) fields[input.startDateFieldId] = input.startDate;
    if (input.assigneeAccountId) fields.assignee = { accountId: input.assigneeAccountId };
    return this.request(`/rest/api/3/issue`, { method: "POST", body: JSON.stringify({ fields }) });
  }

  async deleteIssue(key: string): Promise<void> {
    await this.request(`/rest/api/3/issue/${encodeURIComponent(key)}?deleteSubtasks=true`, {
      method: "DELETE",
    });
  }

  /**
   * Everyone Jira will let you put in the Assignee field of this project.
   *
   * Project-scoped, but only by the *Assignable User* permission — on a
   * company-managed site that is usually granted to a broad group, so this can
   * come back as most of the site rather than the project's team. See
   * projectMembers.ts, which prefers declared project roles and falls back here.
   */
  async getAssignableUsers(projectKey: string): Promise<JiraUserLike[]> {
    return this.request(
      `/rest/api/3/user/assignable/search?project=${encodeURIComponent(projectKey)}&maxResults=100`
    );
  }

  /**
   * The project's role definitions: `{ "Administrators": "<url>", ... }`.
   *
   * The URLs are absolute **site** URLs (gimasys.atlassian.net/...), not gateway
   * ones, so they cannot be fetched as returned — getProjectRoleActors takes the
   * role id out of them and rebuilds the path.
   */
  async getProjectRoles(projectKey: string): Promise<Record<string, string>> {
    return this.request(`/rest/api/3/project/${encodeURIComponent(projectKey)}/role`);
  }

  async getProjectRoleActors(projectKey: string, roleId: string): Promise<{ name?: string; actors?: RoleActor[] }> {
    return this.request(
      `/rest/api/3/project/${encodeURIComponent(projectKey)}/role/${encodeURIComponent(roleId)}`
    );
  }

  /**
   * Members of one group, paged. Roles are usually granted to a group rather
   * than to people one by one, so without this expansion a role read returns a
   * group name and no humans.
   */
  async getGroupMembers(groupId: string): Promise<JiraUserLike[]> {
    const out: JiraUserLike[] = [];
    let startAt = 0;
    for (let page = 0; page < 10; page++) {
      const res = await this.request<{ values: JiraUserLike[]; isLast: boolean }>(
        `/rest/api/3/group/member?groupId=${encodeURIComponent(groupId)}` +
          `&includeInactiveUsers=false&maxResults=50&startAt=${startAt}`
      );
      out.push(...(res.values ?? []));
      if (res.isLast || (res.values?.length ?? 0) === 0) break;
      startAt += res.values.length;
    }
    return out;
  }

  /**
   * Projects the *user* can browse. Note this endpoint pages with startAt/isLast,
   * unlike /search/jql's nextPageToken — paging it wrong silently hides projects
   * past the first 50.
   */
  async listProjects(): Promise<Array<{ id: string; key: string; name: string; avatarUrl: string | null }>> {
    const out: Array<{ id: string; key: string; name: string; avatarUrl: string | null }> = [];
    let startAt = 0;
    for (let page = 0; page < 20; page++) {
      const res = await this.request<{ values: any[]; isLast: boolean; maxResults: number }>(
        `/rest/api/3/project/search?maxResults=50&startAt=${startAt}&orderBy=name`
      );
      for (const p of res.values) {
        out.push({
          id: p.id,
          key: p.key,
          name: p.name,
          avatarUrl: p.avatarUrls?.["24x24"] ?? null,
        });
      }
      if (res.isLast || res.values.length === 0) break;
      startAt += res.values.length;
    }
    return out;
  }

  async getFields(): Promise<Array<{ id: string; name: string; custom: boolean; schema?: { type?: string; custom?: string } }>> {
    return this.request(`/rest/api/3/field`);
  }

  /**
   * The issue types this specific project actually has — not the hard-coded
   * `IssueTypeName` union (Epic|Story|Task|Bug|Sub-task) that `createTask` still
   * uses for the manual "create task" form. A team-managed project routinely
   * renames or drops those, so anything that creates issues in bulk (the AI
   * planner) validates against this instead of assuming the union is universal.
   */
  async getProjectIssueTypes(
    projectKey: string
  ): Promise<Array<{ id: string; name: string; subtask: boolean }>> {
    const res = await this.request<{ issueTypes: Array<{ id: string; name: string; subtask: boolean }> }>(
      `/rest/api/3/project/${encodeURIComponent(projectKey)}`
    );
    return res.issueTypes ?? [];
  }
}
