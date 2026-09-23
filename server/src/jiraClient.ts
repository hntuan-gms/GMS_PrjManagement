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
   * A 403 whose body carries this marker means the app lacks an OAuth scope, not
   * that the user lacks a Jira permission. Retrying it would loop forever.
   */
  get scopeProblem(): boolean {
    return this.status === 403 && /OAuth 2\.0 is not enabled for this method/i.test(this.body);
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
    const res = await fetch(`${JIRA_API_BASE}/ex/jira/${this.opts.cloudId}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
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

  async getTransitions(key: string): Promise<Array<{ id: string; name: string }>> {
    const res = await this.request<{ transitions: Array<{ id: string; name: string }> }>(
      `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`
    );
    return res.transitions;
  }

  async transitionIssue(key: string, transitionName: string): Promise<void> {
    const transitions = await this.getTransitions(key);
    const match = transitions.find((t) => t.name.toLowerCase() === transitionName.toLowerCase());
    if (!match) {
      throw new Error(
        `No transition named "${transitionName}" available for ${key}. Available: ${transitions
          .map((t) => t.name)
          .join(", ")}`
      );
    }
    await this.request(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, {
      method: "POST",
      body: JSON.stringify({ transition: { id: match.id } }),
    });
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
