import type {
  BoardSnapshot,
  ChatSessionSummary,
  EstimateSuggestion,
  Sprint,
  SprintInsight,
  SprintPlanProposal,
  BulkTaskCreateInput,
  BulkTaskCreateResult,
  ChatMessage,
  JiraUser,
  PlanResponse,
  ProgressOverview,
  ProgressReport,
  ReportPoint,
  ResourceAbsence,
  ResourcePool,
  ResourceProfile,
  UsageStats,
  ProjectSummary,
  Session,
  Task,
  TaskCreateInput,
  TaskUpdateInput,
  TaskUpdateResponse,
} from "./types";

// Always same-origin: in production this process also serves the UI, and in dev
// Vite proxies /api to :4000 (see vite.config.ts). Keeping it same-origin is what
// lets the session cookie work identically in both environments.
//
// Setting VITE_API_BASE to a different origin will break login — the cookie is
// SameSite=Lax and won't be sent cross-site.
const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

/** The server answered, but with a non-2xx. `code` is the machine-readable reason. */
export class ApiError extends Error {
  // Declared as plain fields rather than constructor parameter properties:
  // the client tsconfig sets erasableSyntaxOnly.
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** fetch() itself failed — server down, offline, DNS. Distinct from an API error. */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

let unauthorizedHandler: (() => void) | null = null;
let notifiedUnauthorized = false;

/**
 * Lets the session hook pull the whole app back to the login screen from any
 * failed call, instead of each caller rendering its own confusing error.
 */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
  if (fn) notifiedUnauthorized = false;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      // Required for the session cookie to be sent at all.
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new NetworkError("Không kết nối được tới máy chủ.");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 401) {
      // Fire once per burst: a Promise.all of three calls would otherwise trigger
      // three redirects. Still throw, so the awaiting caller unwinds.
      if (!notifiedUnauthorized && unauthorizedHandler) {
        notifiedUnauthorized = true;
        unauthorizedHandler();
      }
    }
    throw new ApiError(res.status, body.error ?? `Request failed: ${res.status}`, body.code);
  }

  notifiedUnauthorized = false;
  if (res.status === 204) return undefined as T;
  return res.json();
}

/**
 * Where the login button navigates. This is a full page navigation, NOT a fetch —
 * a fetch cannot render Atlassian's consent screen and would fail on CORS. Don't
 * "fix" it into an api call.
 */
export const loginUrl = `${API_BASE}/auth/login`;

export const api = {
  getSession: () => request<Session>("/auth/me"),
  listProjects: () => request<ProjectSummary[]>("/auth/projects"),
  selectProject: (key: string) =>
    request<{ key: string; name: string }>("/auth/project", {
      method: "POST",
      body: JSON.stringify({ key }),
    }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),

  listTasks: () => request<Task[]>("/tasks"),
  listUsers: () => request<JiraUser[]>("/users"),
  createTask: (input: TaskCreateInput) =>
    request<Task>("/tasks", { method: "POST", body: JSON.stringify(input) }),
  createTasksBulk: (input: BulkTaskCreateInput) =>
    request<BulkTaskCreateResult>("/tasks/bulk", { method: "POST", body: JSON.stringify(input) }),
  updateTask: (id: string, input: TaskUpdateInput) =>
    request<TaskUpdateResponse>(`/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteTask: (id: string) =>
    request<void>(`/tasks/${encodeURIComponent(id)}`, { method: "DELETE" }),
  // Progress report. The overview is free (computed, no model call); generating a
  // report waits on Gemini and can take several seconds.
  getProgress: (asOf: string) =>
    request<ProgressOverview>(`/progress?asOf=${encodeURIComponent(asOf)}`),
  generateProgressReport: (asOf: string) =>
    request<{ report: ProgressReport; warnings: string[]; history: ReportPoint[] }>("/progress/reports", {
      method: "POST",
      body: JSON.stringify({ asOf }),
    }),
  getProgressReport: (id: string) => request<ProgressReport>(`/progress/reports/${encodeURIComponent(id)}`),

  getResourcePool: () => request<ResourcePool>("/resources"),
  saveResourceProfile: (
    accountId: string,
    patch: {
      displayName: string;
      role?: string | null;
      skills?: string[];
      capacityHoursPerDay?: number;
      notes?: string | null;
    }
  ) =>
    request<ResourceProfile>(`/resources/${encodeURIComponent(accountId)}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
  addAbsence: (accountId: string, from: string, to: string, reason: string | null) =>
    request<ResourceAbsence>(`/resources/${encodeURIComponent(accountId)}/absences`, {
      method: "POST",
      body: JSON.stringify({ from, to, reason }),
    }),
  deleteAbsence: (id: string) =>
    request<void>(`/resources/absences/${encodeURIComponent(id)}`, { method: "DELETE" }),

  sync: () => request<{ syncedAt: string; count: number; tasks: Task[] }>("/sync", { method: "POST" }),

  // AI planner. generatePlan is the slow one — it waits on the model — so callers
  // should show progress rather than assume it returns like the others.
  getPlan: (runId: string) => request<PlanResponse>(`/ai/plans/${encodeURIComponent(runId)}`),
  updatePlanItem: (
    runId: string,
    itemId: string,
    patch: { summary?: string; durationDays?: number; assigneeAccountId?: string | null; issueType?: string }
  ) =>
    request<PlanResponse>(
      `/ai/plans/${encodeURIComponent(runId)}/items/${encodeURIComponent(itemId)}`,
      { method: "PATCH", body: JSON.stringify(patch) }
    ),
  deletePlanItem: (runId: string, itemId: string) =>
    request<PlanResponse>(
      `/ai/plans/${encodeURIComponent(runId)}/items/${encodeURIComponent(itemId)}`,
      { method: "DELETE" }
    ),
  applyPlan: (runId: string, startDate: string) =>
    request<{ created: string[]; errors: Array<{ summary: string; message: string }> }>(
      `/ai/plans/${encodeURIComponent(runId)}/apply`,
      { method: "POST", body: JSON.stringify({ startDate }) }
    ),
  discardPlan: (runId: string) =>
    request<void>(`/ai/plans/${encodeURIComponent(runId)}/discard`, { method: "POST" }),

  // Boards & sprints. Every call writes to Jira directly (see server/src/routes/board.ts).
  getBoard: (boardId: number | null) =>
    request<BoardSnapshot>(`/board${boardId ? `?boardId=${boardId}` : ""}`),
  getTransitions: (key: string) =>
    request<Array<{ id: string; name: string; toStatusId: string }>>(
      `/board/issues/${encodeURIComponent(key)}/transitions`
    ),
  moveCard: (key: string, body: { toStatusIds?: string[]; before?: string | null; after?: string | null }) =>
    request<{ statusId: string | null }>(`/board/issues/${encodeURIComponent(key)}/move`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  rankIssues: (issues: string[], rank: { before?: string; after?: string }) =>
    request<void>("/board/rank", { method: "POST", body: JSON.stringify({ issues, ...rank }) }),
  moveToBacklog: (issues: string[], rank?: { before?: string; after?: string }) =>
    request<void>("/board/backlog", { method: "POST", body: JSON.stringify({ issues, ...rank }) }),
  moveToSprint: (sprintId: number, issues: string[], rank?: { before?: string; after?: string }) =>
    request<void>(`/board/sprints/${sprintId}/issues`, { method: "POST", body: JSON.stringify({ issues, ...rank }) }),
  createSprint: (input: { boardId: number; name: string; goal?: string | null; startDate?: string; endDate?: string }) =>
    request<Sprint>("/board/sprints", { method: "POST", body: JSON.stringify(input) }),
  updateSprint: (id: number, patch: { name?: string; goal?: string | null; startDate?: string; endDate?: string }) =>
    request<Sprint>(`/board/sprints/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  startSprint: (id: number, input: { startDate: string; endDate: string; name?: string; goal?: string }) =>
    request<Sprint>(`/board/sprints/${id}/start`, { method: "POST", body: JSON.stringify(input) }),
  completeSprint: (id: number, moveTo: number | "backlog" | "new") =>
    request<{ moved: number }>(`/board/sprints/${id}/complete`, { method: "POST", body: JSON.stringify({ moveTo }) }),
  setEstimate: (key: string, boardId: number, value: number | null, unit: "points" | "hours") =>
    request<void>(`/board/issues/${encodeURIComponent(key)}/estimate`, {
      method: "PUT",
      body: JSON.stringify({ boardId, value, unit }),
    }),

  // Board AI — proposals only; applying goes through the calls above.
  planSprint: (boardId: number, sprintId: number, clock: { today: string; tzOffsetMinutes: number }) =>
    request<SprintPlanProposal>("/ai/board/plan", {
      method: "POST",
      body: JSON.stringify({ boardId, sprintId, ...clock }),
    }),
  estimateIssues: (boardId: number, keys?: string[]) =>
    request<{ items: EstimateSuggestion[]; unit: "points" | "hours" }>("/ai/board/estimate", {
      method: "POST",
      body: JSON.stringify({ boardId, keys }),
    }),
  sprintInsight: (boardId: number, sprintId: number, clock: { today: string; tzOffsetMinutes: number }) =>
    request<SprintInsight>("/ai/board/insight", {
      method: "POST",
      body: JSON.stringify({ boardId, sprintId, ...clock }),
    }),

  listChatSessions: () => request<ChatSessionSummary[]>("/ai/chat/sessions"),
  renameChatSession: (id: string, title: string) =>
    request<void>(`/ai/chat/sessions/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  deleteChatSession: (id: string) =>
    request<void>(`/ai/chat/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
  getChat: (sessionId: string) =>
    request<{ sessionId: string; messages: ChatMessage[]; usage: UsageStats }>(
      `/ai/chat/${encodeURIComponent(sessionId)}`
    ),
  getUsage: (sessionId: string | null) =>
    request<{ model: string; session: UsageStats | null; project: UsageStats }>(
      `/ai/usage${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`
    ),
};
