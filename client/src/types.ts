export type DependencyType = "FS" | "SS" | "FF" | "SF";

export interface Predecessor {
  taskId: string;
  type: DependencyType;
  lagDays: number;
}

export type IssueTypeName = "Epic" | "Story" | "Task" | "Bug" | "Sub-task";

export interface Task {
  id: string;
  wbsParentId: string | null;
  summary: string;
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
  jiraUrl: string;
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
  statusTransition?: string;
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
}
