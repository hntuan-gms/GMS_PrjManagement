import type { JiraUser, ProjectMeta, Task, TaskCreateInput, TaskUpdateInput } from "./types";

// In production the built app is served by the same Express process as the
// API (see server/src/index.ts), so a same-origin relative path just works.
// In dev, Vite serves the frontend on its own port, so default to the
// backend's dev port unless overridden.
const API_BASE = import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? "http://localhost:4000/api" : "/api");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  getMeta: () => request<ProjectMeta>("/meta"),
  listTasks: () => request<Task[]>("/tasks"),
  listUsers: () => request<JiraUser[]>("/users"),
  createTask: (input: TaskCreateInput) =>
    request<Task>("/tasks", { method: "POST", body: JSON.stringify(input) }),
  updateTask: (id: string, input: TaskUpdateInput) =>
    request<Task>(`/tasks/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteTask: (id: string) =>
    request<void>(`/tasks/${encodeURIComponent(id)}`, { method: "DELETE" }),
  sync: () => request<{ syncedAt: string; count: number; tasks: Task[] }>("/sync", { method: "POST" }),
};
