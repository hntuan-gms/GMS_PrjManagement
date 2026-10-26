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

/** The sprint a task is in: the active one if there is one, else the next, else the latest closed. */
export interface SprintRef {
  id: number;
  name: string;
  state: string;
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
  /** Hours logged against the issue (Jira's `timespent`), across everyone. */
  spentHours: number | null;
  priority: string | null;
  /** Jira labels — free-form tags, no spaces. */
  labels: string[];
  /** Project components, by name. */
  components: string[];
  /** Fix versions (releases), by name. */
  fixVersions: string[];
  /**
   * From the site's Sprint field, which is readable with the ordinary Jira scope —
   * no Agile scope needed. Null when the task is in no sprint or the site has no
   * Jira Software.
   */
  sprint: SprintRef | null;
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
  /** A transition id from GET /tasks/:id/transitions, or a transition/status name. */
  statusTransition?: string;
  /** Jira's Original estimate, in hours. Must be > 0; it is written through `timetracking`. */
  estimateHours?: number;
  /** A priority name from GET /priorities. */
  priority?: string;
  /** The full label set the issue should end up with (replaces, not merges). */
  labels?: string[];
  /** The full component set, by name (replaces, not merges). */
  components?: string[];
  /** The full fix-version set, by name (replaces, not merges). */
  fixVersions?: string[];
  /** Move under this parent; null takes the task off its parent. Checked by structure.ts. */
  parentKey?: string | null;
  /** Change the issue type, by name. Checked by structure.ts, then by Jira's own workflow rules. */
  issueType?: string;
}

export interface TaskCreateInput {
  summary: string;
  labels?: string[];
  components?: string[];
  fixVersions?: string[];
  issueType: IssueTypeName;
  description?: string | null;
  wbsParentId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  durationDays?: number;
  assigneeAccountId?: string | null;
  estimateHours?: number | null;
  /** A priority name from GET /priorities; omitted = the project's default. */
  priority?: string;
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
  estimateHours?: number | null;
  priority?: string;
  labels?: string[];
}

/** One line of an imported sheet. Everything but the title is optional and given as a person would type it. */
export interface ImportRow {
  summary: string;
  issueType?: string;
  description?: string;
  /** A person's name (diacritics optional) or accountId. */
  assignee?: string;
  startDate?: string;
  durationDays?: number;
  /** An existing issue key, or "#N" for the Nth row of this same import (1-based, earlier rows only). */
  parent?: string;
  labels?: string[];
  priority?: string;
  estimateHours?: number;
  components?: string[];
  fixVersions?: string[];
}

export interface ImportResult {
  created: Task[];
  /** `row` is 1-based, as the sheet shows it. */
  errors: Array<{ row: number; summary: string; message: string }>;
  warnings: string[];
  /** Sheet row (1-based) → the issue key it became. Lets a client that sends a long sheet in pieces point later pieces at earlier rows. */
  rowKeys: Record<number, string>;
}

export interface BulkTaskCreateResult {
  created: Task[];
  errors: Array<{ summary: string; message: string }>;
  /** Created, but something secondary (the estimate) didn't stick. */
  warnings: string[];
}
