import type {
  BulkTaskCreateInput,
  BulkTaskCreateResult,
  ChatMessage,
  JiraUser,
  PlanResponse,
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

  getChat: (sessionId: string) =>
    request<{ sessionId: string; messages: ChatMessage[]; usage: UsageStats }>(
      `/ai/chat/${encodeURIComponent(sessionId)}`
    ),
  getUsage: (sessionId: string | null) =>
    request<{ model: string; session: UsageStats | null; project: UsageStats }>(
      `/ai/usage${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`
    ),
};
