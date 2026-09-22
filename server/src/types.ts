export type DependencyType = "FS" | "SS" | "FF" | "SF";

export interface Predecessor {
  taskId: string; // Jira issue key, e.g. HHBJ-12
  type: DependencyType;
  lagDays: number;
}

export type IssueTypeName = "Epic" | "Story" | "Task" | "Bug" | "Sub-task";

/** Internal Task model — MS Project style, backed by a Jira issue plus a local schedule overlay. */
export interface Task {
  id: string; // Jira issue key
  wbsParentId: string | null; // Jira parent/epic key
  summary: string;
  description: string | null;
  issueType: IssueTypeName;
  statusName: string;
  statusCategory: "new" | "indeterminate" | "done";
  assigneeAccountId: string | null;
  assigneeName: string | null;
  assigneeAvatarUrl: string | null;
  startDate: string | null; // ISO date, local-only field (Jira has no universal start date)
  dueDate: string | null; // ISO date, synced with Jira `duedate`
  durationDays: number;
  percentComplete: number;
  predecessors: Predecessor[];
  baselineStart: string | null;
  baselineDue: string | null;
  jiraUrl: string;
}

/** The acting user plus the site/project their session is bound to. */
export interface SessionMeta {
  user: { accountId: string; displayName: string; avatarUrl: string | null };
  site: { cloudId: string; url: string; name: string };
  project: { key: string; name: string } | null;
  /** null when this site has no native Start date field; dates then ride on duedate alone. */
  startDateFieldId: string | null;
  /**
   * True while the overlay lives on the container's ephemeral disk, so the client
   * can warn that dependencies, baselines and % complete reset on each deploy.
   */
  overlayEphemeral: boolean;
}

export interface ProjectSummary {
  id: string;
  key: string;
  name: string;
  avatarUrl: string | null;
}

export interface JiraUser {
  accountId: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface TaskUpdateInput {
  summary?: string;
  description?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  durationDays?: number;
  percentComplete?: number;
  assigneeAccountId?: string | null;
  predecessors?: Predecessor[];
  baselineStart?: string | null;
  baselineDue?: string | null;
  statusTransition?: string; // Jira transition name, e.g. "Done"
}

export interface TaskCreateInput {
  summary: string;
  issueType: IssueTypeName;
  description?: string | null;
  wbsParentId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  durationDays?: number;
  assigneeAccountId?: string | null;
}

/** One shared set of fields, applied to N summaries — mirrors Jira's own "create several issues" bulk dialog. */
export interface BulkTaskCreateInput {
  summaries: string[];
  issueType: IssueTypeName;
  description?: string | null;
  wbsParentId?: string | null;
  startDate?: string | null;
  durationDays?: number;
  assigneeAccountId?: string | null;
}

export interface BulkTaskCreateResult {
  created: Task[];
  errors: Array<{ summary: string; message: string }>;
}
