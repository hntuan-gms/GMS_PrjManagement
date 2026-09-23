export type DependencyType = "FS" | "SS" | "FF" | "SF";

export interface Predecessor {
  taskId: string;
  type: DependencyType;
  lagDays: number;
}

export type IssueTypeName = "Epic" | "Story" | "Task" | "Bug" | "Sub-task";

/**
 * An Epic is a container, not a unit of work, so it takes no assignee — the
 * server rejects one either way (server/src/types.ts holds the same rule and
 * the reasoning). The UI uses this to hide the field rather than let someone
 * pick a person and have the save fail.
 */
export function isAssignableType(issueType: string | null | undefined): boolean {
  return (issueType ?? "").toLowerCase() !== "epic";
}

export interface Task {
  id: string;
  wbsParentId: string | null;
  summary: string;
  description: string | null;
  issueType: IssueTypeName;
  statusName: string;
  statusCategory: "new" | "indeterminate" | "done";
  assigneeAccountId: string | null;
  assigneeName: string | null;
  assigneeAvatarUrl: string | null;
  startDate: string | null;
  dueDate: string | null;
  durationDays: number;
  percentComplete: number;
  predecessors: Predecessor[];
  baselineStart: string | null;
  baselineDue: string | null;
  /**
   * Jira's original estimate, in hours (its API stores seconds). Read-only here
   * and often null — the resource view falls back to "one task fills a working
   * day" when it is, because a team that never estimates should still get a
   * usable heatmap rather than an empty one.
   */
  estimateHours: number | null;
  jiraUrl: string;
}

export interface JiraUser {
  accountId: string;
  displayName: string;
  avatarUrl: string | null;
}

/** Capacity and skills we store about a person; Jira owns everything else. */
export interface ResourceProfile {
  accountId: string;
  role: string | null;
  skills: string[];
  capacityHoursPerDay: number;
  costPerDay: number | null;
  notes: string | null;
}

/** Planned leave. Days inside the range have zero capacity. */
export interface ResourceAbsence {
  id: string;
  accountId: string;
  from: string;
  to: string;
  reason: string | null;
}

export interface ResourcePool {
  users: JiraUser[];
  /**
   * "project-roles" = Jira's declared project membership. "assignable" = the
   * fallback for an account that cannot read roles: everyone with the Assignable
   * User permission, which on a company-managed site is most of the site.
   */
  memberSource: "project-roles" | "assignable";
  /** Which roles contributed, when memberSource is "project-roles". */
  memberRoles: string[];
  /** The assignable fallback hit Jira's 100-user cap and may be incomplete. */
  memberTruncated: boolean;
  profiles: ResourceProfile[];
  absences: ResourceAbsence[];
  defaultCapacityHours: number;
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
  statusTransition?: string;
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

/**
 * What PATCH /tasks/:id returns: the edited task, plus every OTHER task the
 * dependency cascade moved as a side effect, fully hydrated. Applying `cascaded`
 * directly is what lets the client skip a separate GET /tasks after every
 * schedule edit — that extra round trip used to arrive a moment later and
 * visibly snap the chart to the confirmed values.
 */
export interface TaskUpdateResponse extends Task {
  cascaded: Task[];
  cascadeWarnings?: string[];
}

/** One task the AI planner has proposed. Nothing here exists in Jira yet. */
export interface PlanItem {
  id: string;
  tempId: string;
  parentTempId: string | null;
  sortOrder: number;
  summary: string;
  description: string | null;
  issueType: string;
  durationDays: number;
  assigneeAccountId: string | null;
  dependencies: Array<{ tempId: string; type: DependencyType; lagDays: number }>;
  rationale: string | null;
  /** Derived server-side from durations and the dependency graph, never stored. */
  startDate: string;
  dueDate: string;
  /** Set once this row has been created in Jira. */
  appliedIssueKey: string | null;
}

export interface PlanRun {
  id: string;
  projectKey: string;
  status: "running" | "proposed" | "applied" | "failed" | "discarded";
  brief: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  error: string | null;
  createdAt: string;
  appliedAt: string | null;
}

export interface PlanResponse {
  run: PlanRun;
  items: PlanItem[];
  /** Things the server quietly corrected in the model's output. */
  warnings?: string[];
}

/** Gemini's counters kept apart: they price differently, so one total cannot be costed. */
export interface UsageStats {
  messages: number;
  promptTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  cachedTokens: number;
  totalTokens: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "model";
  content: string;
  thinking: string | null;
  /** Set when this turn produced a plan — the bubble renders a clickable table card. */
  planRunId: string | null;
  model: string | null;
  usage: Omit<UsageStats, "messages" | "totalTokens">;
  createdAt: string;
}

export interface AuthUser {
  accountId: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface AtlassianSite {
  cloudId: string;
  url: string;
  name: string;
}

export interface ProjectSummary {
  id: string;
  key: string;
  name: string;
  avatarUrl: string | null;
}

/** What GET /api/auth/me returns once a session exists. */
export interface Session {
  user: AuthUser;
  site: AtlassianSite;
  /** null until the user picks one; the app shows the picker in that state. */
  project: { key: string; name: string } | null;
  /** null when this site has no native Start date field. */
  startDateFieldId: string | null;
  /** True while schedule overlays live on the server's ephemeral disk. */
  overlayEphemeral: boolean;
  /**
   * Internal staff. Guests invited to the Jira site get everything except the AI
   * assistant, so the dock is hidden for them rather than handed a 403 they can
   * do nothing about.
   */
  staff: boolean;
}
