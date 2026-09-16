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
  isMock?: boolean;
}

export interface JiraUser {
  accountId: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface TaskUpdateInput {
  summary?: string;
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
  wbsParentId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  durationDays?: number;
  assigneeAccountId?: string | null;
}
