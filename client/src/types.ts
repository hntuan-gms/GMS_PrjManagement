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
  /**
   * Why roles couldn't be used, when memberSource is "assignable". Mirrors
   * FallbackReason in server/src/projectMembers.ts.
   */
  memberFallback: {
    reason:
      | "roles-forbidden"
      | "actors-unreadable"
      | "groups-unreadable"
      | "groups-out-of-scope"
      | "roles-empty"
      | "error";
    status?: number;
  } | null;
  /**
   * Role groups whose members couldn't be listed while memberSource is still
   * "project-roles" — the list is then only the individually-added people.
   */
  memberSkippedGroups: number;
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
  /**
   * Set when this turn generated a progress report. Client-side only: it is not
   * a chat_message column, so a transcript reloaded from the server shows the
   * reply text (which points at the Báo cáo tab) without the card.
   */
  reportId?: string | null;
  reportHeadline?: string | null;
  reportHealth?: string | null;
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

/* ----------------------------------------------------------------------------
 * Progress report — shapes mirror server/src/progress.ts and ai/reportStore.ts.
 * Every number here is computed server-side; the AI only writes `narrative`.
 * -------------------------------------------------------------------------- */

export type Health = "on_track" | "at_risk" | "off_track";

export interface ProgressTaskRef {
  id: string;
  summary: string;
  assignee: string | null;
  startDate: string | null;
  dueDate: string | null;
  statusName: string;
  critical: boolean;
}

export interface ProgressMetrics {
  asOf: string;
  counts: {
    total: number;
    done: number;
    inProgress: number;
    todo: number;
    overdue: number;
    slipped: number;
    notStarted: number;
    unassigned: number;
    undated: number;
    noBaseline: number;
    criticalOpen: number;
  };
  actualPct: number;
  plannedPct: number;
  spi: number | null;
  health: Health;
  healthReasons: string[];
  schedule: {
    start: string | null;
    plannedEnd: string | null;
    baselineEnd: string | null;
    slipDays: number | null;
    daysRemaining: number | null;
  };
  overdue: Array<ProgressTaskRef & { daysLate: number }>;
  slipped: Array<ProgressTaskRef & { baselineDue: string; slipDays: number }>;
  dueSoon: ProgressTaskRef[];
  notStarted: ProgressTaskRef[];
  unassigned: ProgressTaskRef[];
  phases: Array<{
    id: string | null;
    summary: string;
    total: number;
    done: number;
    actualPct: number;
    plannedPct: number;
    start: string | null;
    end: string | null;
    baselineEnd: string | null;
    overdue: number;
  }>;
  people: Array<{
    accountId: string | null;
    name: string;
    open: number;
    inProgress: number;
    done: number;
    overdue: number;
  }>;
}

export type InsightKind = "bottleneck" | "dependency" | "people" | "scope" | "data" | "momentum";
export type ActionPriority = "now" | "this_week" | "later";

/**
 * Mirrors server/src/ai/report.ts. `outlook`, `insights`, `mitigation`,
 * `priority`, `owner` and `expectedImpact` are optional because reports saved
 * before the reasoning pass don't have them — old history must still open.
 */
export interface ReportNarrative {
  headline: string;
  summary: string;
  outlook?: { verdict: "on_time" | "at_risk" | "late"; confidence: "high" | "medium" | "low"; reasoning: string };
  insights?: Array<{ kind: InsightKind; title: string; detail: string; issueKeys: string[] }>;
  highlights: string[];
  risks: Array<{
    title: string;
    detail: string;
    severity: "high" | "medium" | "low";
    issueKeys: string[];
    mitigation?: string;
  }>;
  recommendations: Array<{
    action: string;
    rationale: string;
    issueKeys: string[];
    priority?: ActionPriority;
    owner?: string | null;
    expectedImpact?: string;
  }>;
}

export interface ProgressReport {
  id: string;
  createdAt: string;
  createdBy: string;
  asOf: string;
  health: Health;
  actualPct: number;
  plannedPct: number;
  /** Snapshot of the numbers the narrative was written from. */
  metrics: ProgressMetrics;
  narrative: ReportNarrative;
  model: string | null;
  usage: {
    promptTokens: number | null;
    outputTokens: number | null;
    thoughtTokens: number | null;
    cachedTokens: number | null;
  };
}

export interface ReportPoint {
  id: string;
  createdAt: string;
  asOf: string;
  health: Health;
  actualPct: number;
  plannedPct: number;
  headline: string;
}

export interface ProgressOverview {
  metrics: ProgressMetrics;
  latest: ProgressReport | null;
  history: ReportPoint[];
}

/* ----------------------------------------------------------------------------
 * Boards & sprints — mirror server/src/agile/boardTypes.ts and ai/sprintAi.ts.
 * -------------------------------------------------------------------------- */

export type StatusCategory = "new" | "indeterminate" | "done";

export interface BoardSummary {
  id: number;
  name: string;
  type: string;
}

export interface BoardColumn {
  name: string;
  statusIds: string[];
  min: number | null;
  max: number | null;
}

export interface BoardStatus {
  id: string;
  name: string;
  category: StatusCategory;
}

export interface Sprint {
  id: number;
  name: string;
  state: "active" | "future" | "closed";
  goal: string | null;
  startDate: string | null;
  endDate: string | null;
  completeDate: string | null;
}

export interface BoardIssue {
  key: string;
  summary: string;
  issueType: string;
  subtask: boolean;
  statusId: string;
  statusName: string;
  statusCategory: StatusCategory;
  assigneeAccountId: string | null;
  assigneeName: string | null;
  priority: string | null;
  estimate: number | null;
  sprintId: number | null;
  epicKey: string | null;
  epicSummary: string | null;
  parentKey: string | null;
  flagged: boolean;
  labels: string[];
  dueDate: string | null;
  resolutionDate: string | null;
  updated: string | null;
  blockedBy: string[];
}

export interface VelocityPoint {
  sprintId: number;
  name: string;
  startDate: string | null;
  completeDate: string | null;
  completed: number;
  completedCount: number;
}

export interface BoardSnapshot {
  mode: "agile" | "status";
  fallback: { reason: "disabled" | "scope" | "no_board"; message: string } | null;
  boards: BoardSummary[];
  board: BoardSummary | null;
  columns: BoardColumn[];
  statuses: BoardStatus[];
  estimation: { fieldId: string; name: string; unit: "points" | "hours" } | null;
  sprints: Sprint[];
  velocity: VelocityPoint[];
  throughput: Array<{ weekStart: string; count: number }>;
  issues: BoardIssue[];
  truncated: boolean;
}

export interface AiUsage {
  promptTokens: number | null;
  outputTokens: number | null;
  thoughtTokens: number | null;
}

export interface SprintPlanProposal {
  goal: string;
  rationale: string;
  picks: Array<{ key: string; reason: string }>;
  deferred: Array<{ key: string; reason: string }>;
  risks: string[];
  totals: { weight: number; count: number; budget: number | null; unit: string; unestimated: number };
  warnings: string[];
  model: string;
  usage: AiUsage;
}

export interface EstimateSuggestion {
  key: string;
  value: number;
  confidence: "high" | "medium" | "low";
  reason: string;
  similar: string[];
}

export interface SprintFacts {
  sprint: { id: number; name: string; goal: string | null; start: string | null; end: string | null };
  days: { total: number; elapsed: number; left: number };
  elapsedPct: number;
  unit: string;
  scope: { count: number; weight: number; unestimated: number };
  done: { count: number; weight: number };
  inProgress: { count: number; weight: number };
  todo: { count: number; weight: number };
  donePct: number;
  pace: "ahead" | "on_pace" | "behind" | "not_started";
  people: Array<{ name: string; open: number; openWeight: number; inProgress: number; done: number }>;
  blocked: Array<{ key: string; summary: string; blockedBy: string[] }>;
  flagged: Array<{ key: string; summary: string }>;
  stale: Array<{ key: string; summary: string; assignee: string | null; idleDays: number }>;
  unassigned: string[];
  unestimated: string[];
}

export interface SprintInsight {
  headline: string;
  forecast: { verdict: "will_meet" | "at_risk" | "will_miss"; confidence: "high" | "medium" | "low"; reasoning: string };
  actions: Array<{ title: string; detail: string; owner: string | null; issueKeys: string[] }>;
  descope: Array<{ key: string; reason: string }>;
  facts: SprintFacts;
  model: string;
  usage: AiUsage;
}
