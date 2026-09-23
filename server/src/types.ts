export type DependencyType = "FS" | "SS" | "FF" | "SF";

export interface Predecessor {
  taskId: string; // Jira issue key, e.g. HHBJ-12
  type: DependencyType;
  lagDays: number;
}

export type IssueTypeName = "Epic" | "Story" | "Task" | "Bug" | "Sub-task";

/**
 * An Epic is a container, not a unit of work, so it takes no assignee.
 *
 * Enforced rather than merely discouraged because an assigned Epic corrupts
 * every workload number downstream: its span is its children's full min/max
 * (see ganttMapping.resolveRanges), so one Epic would book its owner solid for
 * the length of the whole phase on top of the children they are actually doing.
 *
 * Mirrored in client/src/types.ts — keep both in step.
 */
export function isAssignableType(issueType: string | null | undefined): boolean {
  return (issueType ?? "").toLowerCase() !== "epic";
}

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
  /** Jira's original estimate in hours, when the team fills one in. */
  estimateHours: number | null;
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
  /**
   * Internal staff. Guests invited to the Jira site get everything except the AI
   * features, which bill against a shared key — the client hides the assistant
   * rather than letting them hit a 403 they can do nothing about.
   */
  staff: boolean;
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
