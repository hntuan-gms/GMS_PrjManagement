/**
 * Board / sprint shapes on the wire. Mirrored in client/src/types.ts.
 *
 * A board is Jira's, not ours: columns, rank, sprints and the estimation field
 * all come from Jira Software on every load, so the Bảng tab can never become a
 * second, drifting copy of the team's real board. The one thing added on top is
 * `blockedBy`, from our own dependency graph (task_dependency) — Jira issue links
 * carry no "must finish first" semantics, so this is information a Jira board
 * genuinely does not have.
 */

export type StatusCategory = "new" | "indeterminate" | "done";

export interface BoardSummary {
  id: number;
  name: string;
  /** "scrum" | "kanban" | "simple" (team-managed). Only scrum boards have sprints. */
  type: string;
}

export interface BoardColumn {
  name: string;
  statusIds: string[];
  /** WIP limits from the board configuration, when the team set them. */
  min: number | null;
  max: number | null;
  /** Not a column on the Jira board: a status no column maps, shown so its cards don't vanish. */
  unmapped?: boolean;
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
  /** ISO datetimes as Jira returns them; the client converts to local dates. */
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
  /** In the board's estimation unit (points, or hours for time-based boards). Null = not estimated. */
  estimate: number | null;
  /** The open (active/future) sprint the issue is in; null = backlog. */
  sprintId: number | null;
  epicKey: string | null;
  epicSummary: string | null;
  parentKey: string | null;
  flagged: boolean;
  labels: string[];
  dueDate: string | null;
  resolutionDate: string | null;
  updated: string | null;
  /** Unfinished predecessors from our dependency graph — the card can't really move until these do. */
  blockedBy: string[];
}

export interface VelocityPoint {
  sprintId: number;
  name: string;
  startDate: string | null;
  completeDate: string | null;
  /** Estimate completed inside the sprint's own window. */
  completed: number;
  completedCount: number;
}

export interface BoardFallback {
  reason: "disabled" | "scope" | "no_board";
  message: string;
}

export interface BoardSnapshot {
  /** "agile" = a real Jira Software board; "status" = columns from the project's statuses, no sprints. */
  mode: "agile" | "status";
  fallback: BoardFallback | null;
  boards: BoardSummary[];
  board: BoardSummary | null;
  columns: BoardColumn[];
  statuses: BoardStatus[];
  estimation: { fieldId: string; name: string; unit: "points" | "hours" } | null;
  /** Active and future sprints, in the board's order. */
  sprints: Sprint[];
  /** Last closed sprints, oldest first. */
  velocity: VelocityPoint[];
  /** Kanban throughput: issues finished per week over the last six weeks, oldest first. */
  throughput: Array<{ weekStart: string; count: number }>;
  /** In board rank order. */
  issues: BoardIssue[];
  truncated: boolean;
}
