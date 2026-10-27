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
  ImportResult,
  ImportRow,
  IssueLink,
  JiraUser,
  LinkType,
  ProjectComponent,
  ProjectVersion,
  Watchers,
  PlanResponse,
  ActivityEntry,
  ProgressOverview,
  ProgressScope,
  ProgressReport,
  ReportPoint,
  ResourceAbsence,
  SprintCapacity,
  SprintReport,
  FlowReport,
  ResourcePool,
  ResourceProfile,
  UsageStats,
  ProjectSummary,
  Session,
  Task,
  TaskCreateInput,
  TaskUpdateInput,
  TaskUpdateResponse,
  TaskTransition,
  TaskAttachments,
  TaskComment,
  Timesheet,
  WorklogEntry,
  KbktOptions,
  KbktPreview,
  KbktRunParams,
  KbktStory,
  KbktSettings,
  KbktStreamEvent,
  SavedFilter,
  SavedFilterSpec,
} from "./types";
import { readSse } from "./sse";

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
  /** Structured extras some errors carry — the fields a status change needs (TRANSITION_FIELDS_REQUIRED). */
  readonly details: unknown;

  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** fetch() itself failed — server down, offline, DNS. Distinct from an API error. */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

/**
 * The project THIS tab is on. The session cookie holds one project for the whole browser,
 * so a second tab on another project used to rewrite it under the first. Each tab keeps its
 * own in sessionStorage (a new tab starts empty and takes the session's default; a
 * duplicated tab inherits it) and names it on every request.
 */
const TAB_PROJECT_KEY = "gms.tab.project";
let tabProject: string | null = (() => {
  try {
    return sessionStorage.getItem(TAB_PROJECT_KEY);
  } catch {
    return null;
  }
})();

export function setTabProject(key: string | null): void {
  tabProject = key;
  try {
    if (key) sessionStorage.setItem(TAB_PROJECT_KEY, key);
    else sessionStorage.removeItem(TAB_PROJECT_KEY);
  } catch {
    // Without storage the tab still holds it in memory until reloaded.
  }
}

/** Headers every call to the API carries to say which project it is about. */
export function projectHeaders(): Record<string, string> {
  return tabProject ? { "X-Project-Key": tabProject } : {};
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
      headers: { "Content-Type": "application/json", ...projectHeaders(), ...(init?.headers ?? {}) },
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
    throw new ApiError(res.status, body.error ?? `Request failed: ${res.status}`, body.code, body.details);
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

function kbktQuery(params: KbktRunParams): string {
  const q = new URLSearchParams();
  if (params.epic) q.set("epic", params.epic);
  if (params.story) q.set("story", params.story);
  if (params.dueDate) q.set("dueDate", params.dueDate);
  if (params.force) q.set("force", "1");
  const s = q.toString();
  return s ? `?${s}` : "";
}

// The workbook goes up as the raw body, its name in a header — like an attachment.
function kbktUpload(file: File): RequestInit {
  return {
    method: "POST",
    body: file,
    headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name), ...projectHeaders() },
  };
}

/**
 * The real import, streamed. A problem with the upload itself (not a KBKT file,
 * no project) is a normal error response and throws; once the stream starts,
 * failures arrive as an `error` event. Aborting `signal` stops the run on the
 * server between two Jira calls.
 */
export async function* kbktApply(file: File, params: KbktRunParams, signal: AbortSignal): AsyncGenerator<KbktStreamEvent> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/kbkt/apply${kbktQuery(params)}`, { ...kbktUpload(file), credentials: "include", signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new NetworkError("Không kết nối được tới máy chủ.");
  }
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 401 && unauthorizedHandler) unauthorizedHandler();
    throw new ApiError(res.status, body.error ?? `Request failed: ${res.status}`, body.code, body.details);
  }
  yield* readSse<KbktStreamEvent>(res);
}

/** One attachment's bytes, as a Blob — fetched here (not an <img src>) so the call carries the tab's project. */
async function fetchAttachment(id: string, attId: string, inline: boolean): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/tasks/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attId)}/content${inline ? "?inline=1" : ""}`, {
      credentials: "include",
      headers: projectHeaders(),
    });
  } catch {
    throw new NetworkError("Không kết nối được tới máy chủ.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 401 && unauthorizedHandler) unauthorizedHandler();
    throw new ApiError(res.status, body.error ?? `Request failed: ${res.status}`, body.code, body.details);
  }
  return res.blob();
}

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
  listPriorities: () => request<string[]>("/priorities"),
  listLabels: () => request<string[]>("/labels"),
  listIssueTypes: () => request<Array<{ name: string; subtask: boolean }>>("/issue-types"),
  listComponents: () => request<ProjectComponent[]>("/components"),
  listVersions: () => request<ProjectVersion[]>("/versions"),
  listLinkTypes: () => request<LinkType[]>("/link-types"),
  // Jira issue links (blocks / relates …). Not addTaskLink below, which uploads a web link.
  getIssueLinks: (id: string) => request<IssueLink[]>(`/tasks/${encodeURIComponent(id)}/issue-links`),
  addIssueLink: (id: string, input: { typeName: string; otherKey: string; direction: "outward" | "inward" }) =>
    request<IssueLink[]>(`/tasks/${encodeURIComponent(id)}/issue-links`, { method: "POST", body: JSON.stringify(input) }),
  removeIssueLink: (id: string, linkId: string) =>
    request<IssueLink[]>(`/tasks/${encodeURIComponent(id)}/issue-links/${encodeURIComponent(linkId)}`, { method: "DELETE" }),
  getTaskWatchers: (id: string) => request<Watchers>(`/tasks/${encodeURIComponent(id)}/watchers`),
  setTaskWatching: (id: string, watching: boolean) =>
    request<Watchers>(`/tasks/${encodeURIComponent(id)}/watchers`, { method: "PUT", body: JSON.stringify({ watching }) }),
  /** Which of this project's issues match a JQL — the string goes to Jira as typed. */
  searchJql: (jql: string) =>
    request<{ keys: string[]; truncated: boolean }>("/tasks/jql", { method: "POST", body: JSON.stringify({ jql }) }),
  importTasks: (rows: ImportRow[]) =>
    request<ImportResult>("/tasks/import", { method: "POST", body: JSON.stringify({ rows }) }),
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
  getTaskTransitions: (id: string) =>
    request<TaskTransition[]>(`/tasks/${encodeURIComponent(id)}/transitions`),
  listComments: (id: string) => request<TaskComment[]>(`/tasks/${encodeURIComponent(id)}/comments`),
  addComment: (id: string, text: string) =>
    request<TaskComment>(`/tasks/${encodeURIComponent(id)}/comments`, { method: "POST", body: JSON.stringify({ text }) }),
  updateComment: (id: string, commentId: string, text: string) =>
    request<TaskComment>(`/tasks/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}`, {
      method: "PUT",
      body: JSON.stringify({ text }),
    }),
  deleteComment: (id: string, commentId: string) =>
    request<void>(`/tasks/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}`, { method: "DELETE" }),
  listActivity: (id: string) => request<ActivityEntry[]>(`/tasks/${encodeURIComponent(id)}/activity`),
  getTaskDescription: (id: string) =>
    request<{ description: string | null }>(`/tasks/${encodeURIComponent(id)}/description`),
  getTaskAttachments: (id: string) =>
    request<TaskAttachments>(`/tasks/${encodeURIComponent(id)}/attachments`),
  getAttachmentBlob: (id: string, attId: string, inline: boolean) => fetchAttachment(id, attId, inline),
  deleteAttachment: (id: string, attId: string) =>
    request<void>(`/tasks/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attId)}`, { method: "DELETE" }),
  // The file goes up as the raw body, its name in a header — see routes/api.ts.
  uploadAttachment: (id: string, file: File) =>
    request<Array<{ id: string; filename: string; size: number }>>(`/tasks/${encodeURIComponent(id)}/attachments`, {
      method: "POST",
      body: file,
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name || "anh-dan.png"),
        "X-File-Type": file.type || "application/octet-stream",
      },
    }),
  addTaskLink: (id: string, url: string, title: string) =>
    request<{ id: string; url: string; title: string }>(`/tasks/${encodeURIComponent(id)}/links`, {
      method: "POST",
      body: JSON.stringify({ url, title }),
    }),

  // Timesheet — Jira worklogs, read and written directly.
  getTimesheet: (from: string, to: string) =>
    request<Timesheet>(
      `/timesheet?from=${from}&to=${to}&tz=${-new Date().getTimezoneOffset()}`
    ),
  logWork: (input: { issueKey: string; date: string; hours: number; comment?: string | null }) =>
    request<WorklogEntry>("/timesheet/worklogs", {
      method: "POST",
      body: JSON.stringify({ ...input, tzOffsetMinutes: -new Date().getTimezoneOffset() }),
    }),
  /** Only what is passed changes; `comment: null` clears the note. */
  updateWorklog: (issueKey: string, id: string, patch: { date?: string; hours?: number; comment?: string | null }) =>
    request<WorklogEntry>(`/timesheet/worklogs/${encodeURIComponent(issueKey)}/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ ...patch, tzOffsetMinutes: -new Date().getTimezoneOffset() }),
    }),
  deleteWorklog: (issueKey: string, id: string) =>
    request<void>(`/timesheet/worklogs/${encodeURIComponent(issueKey)}/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  // Progress report. The overview is free (computed, no model call); generating a
  // report waits on Gemini and can take several seconds.
  getProgress: (asOf: string, scope?: ProgressScope) => {
    const q = new URLSearchParams({ asOf });
    if (scope?.assignee) q.set("assignee", scope.assignee);
    if (scope?.epic) q.set("epic", scope.epic);
    if (scope?.types && scope.types.length > 0) q.set("type", scope.types.join(","));
    return request<ProgressOverview>(`/progress?${q}`);
  },
  getFlow: (days: 30 | 60 | 90, today: string) =>
    request<FlowReport>(`/progress/flow?days=${days}&today=${today}&tz=${-new Date().getTimezoneOffset()}`),
  deleteProgressReport: (id: string) =>
    request<{ history: ReportPoint[] }>(`/progress/reports/${encodeURIComponent(id)}`, { method: "DELETE" }),
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
  updateAbsence: (id: string, patch: { from?: string; to?: string; reason?: string | null }) =>
    request<ResourceAbsence>(`/resources/absences/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteAbsence: (id: string) =>
    request<void>(`/resources/absences/${encodeURIComponent(id)}`, { method: "DELETE" }),

  sync: () => request<{ syncedAt: string; count: number; tasks: Task[] }>("/sync", { method: "POST" }),

  // KBKT import. The preview reads Jira and writes nothing; kbktApply (above) is the real run.
  getKbktOptions: () => request<KbktOptions>("/kbkt/options"),
  getKbktSettings: () => request<KbktSettings>("/kbkt/settings"),
  saveKbktSettings: (settings: KbktSettings) =>
    request<KbktSettings>("/kbkt/settings", { method: "PUT", body: JSON.stringify(settings) }),
  previewKbkt: (file: File, params: KbktRunParams) =>
    request<KbktPreview>(`/kbkt/preview${kbktQuery(params)}`, kbktUpload(file)),
  /** Story-level issues of the project by key or title; empty query → the most recently touched. */
  searchKbktStories: (q: string) => request<KbktStory[]>(`/kbkt/stories?q=${encodeURIComponent(q)}`),

  // Saved filters (Gantt + resource tab). Only the creator can change or delete one.
  listSavedFilters: () => request<SavedFilter[]>("/filters"),
  createSavedFilter: (input: { name: string; shared: boolean; spec: SavedFilterSpec }) =>
    request<SavedFilter>("/filters", { method: "POST", body: JSON.stringify(input) }),
  updateSavedFilter: (id: string, input: { name?: string; shared?: boolean; spec?: SavedFilterSpec }) =>
    request<SavedFilter>(`/filters/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteSavedFilter: (id: string) => request<void>(`/filters/${encodeURIComponent(id)}`, { method: "DELETE" }),

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
  createBoard: (name: string, type: "scrum" | "kanban") =>
    request<{ id: number; name: string; type: string }>("/board/boards", {
      method: "POST",
      body: JSON.stringify({ name, type }),
    }),
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

  getQuickFilterKeys: (boardId: number, ids: number[]) =>
    request<{ keys: string[] }>(`/board/quickfilters/keys?boardId=${boardId}&ids=${ids.join(",")}`),
  setFlag: (key: string, flagged: boolean) =>
    request<void>(`/board/issues/${encodeURIComponent(key)}/flag`, { method: "PUT", body: JSON.stringify({ flagged }) }),
  deleteSprint: (id: number) => request<{ moved: number }>(`/board/sprints/${id}`, { method: "DELETE" }),
  getSprintReport: (sprintId: number, clock: { today: string; tzOffsetMinutes: number }) =>
    request<SprintReport>(`/board/sprints/${sprintId}/report?today=${clock.today}&tz=${clock.tzOffsetMinutes}`),
  getSprintCapacity: (boardId: number, sprintId: number, clock: { today: string; tzOffsetMinutes: number }) =>
    request<SprintCapacity>(
      `/board/sprints/${sprintId}/capacity?boardId=${boardId}&today=${clock.today}&tz=${clock.tzOffsetMinutes}`
    ),

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
    request<{
      model: string;
      /** Whether GEMINI_PRICING has a price for the active model. */
      pricing: { configured: boolean; currency: string };
      session: UsageStats | null;
      project: UsageStats;
    }>(
      `/ai/usage${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`
    ),
};
