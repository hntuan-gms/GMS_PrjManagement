export interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  /** Custom field ID for Jira's native "Start date" field, if this project has one. */
  startDateFieldId: string;
}

export function loadJiraConfig(): JiraConfig | null {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;
  const projectKey = process.env.JIRA_PROJECT_KEY;
  if (!baseUrl || !email || !apiToken || !projectKey) return null;
  const startDateFieldId = process.env.JIRA_START_DATE_FIELD_ID || "customfield_10059";
  return { baseUrl: baseUrl.replace(/\/+$/, ""), email, apiToken, projectKey, startDateFieldId };
}

export class JiraApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`Jira API error ${status}: ${body}`);
  }
}

export class JiraClient {
  constructor(private cfg: JiraConfig) {}

  private authHeader() {
    const token = Buffer.from(`${this.cfg.email}:${this.cfg.apiToken}`).toString("base64");
    return `Basic ${token}`;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.cfg.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: this.authHeader(),
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new JiraApiError(res.status, body);
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
    const match = transitions.find(
      (t) => t.name.toLowerCase() === transitionName.toLowerCase()
    );
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
    parentKey?: string | null;
    dueDate?: string | null;
    startDate?: string | null;
    startDateFieldId?: string;
    assigneeAccountId?: string | null;
  }): Promise<{ id: string; key: string }> {
    const fields: Record<string, unknown> = {
      project: { key: input.projectKey },
      issuetype: { name: input.issueTypeName },
      summary: input.summary,
    };
    if (input.parentKey) fields.parent = { key: input.parentKey };
    if (input.dueDate) fields.duedate = input.dueDate;
    if (input.startDate && input.startDateFieldId) fields[input.startDateFieldId] = input.startDate;
    if (input.assigneeAccountId) fields.assignee = { accountId: input.assigneeAccountId };
    return this.request(`/rest/api/3/issue`, {
      method: "POST",
      body: JSON.stringify({ fields }),
    });
  }

  async deleteIssue(key: string): Promise<void> {
    await this.request(`/rest/api/3/issue/${encodeURIComponent(key)}?deleteSubtasks=true`, {
      method: "DELETE",
    });
  }

  async getAssignableUsers(projectKey: string): Promise<Array<{ accountId: string; displayName: string; avatarUrls?: Record<string, string> }>> {
    return this.request(
      `/rest/api/3/user/assignable/search?project=${encodeURIComponent(projectKey)}&maxResults=100`
    );
  }
}
