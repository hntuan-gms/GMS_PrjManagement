import type { JiraUser, Task } from "./types";

/**
 * The last project data this browser saw, so opening a project shows it at once and
 * the fresh copy replaces it when it arrives (ProjectWorkspace.loadAll). Without it
 * the screen waits for Jira — seconds on a big project, and longer when Cloud Run has
 * to start a container first.
 *
 * Keyed by site, ACCOUNT and project: what a person may see depends on their Jira
 * permissions, so a second person logging in on the same computer must never be
 * handed the first one's tasks. Logout clears everything as well (clearTasksCache).
 * Descriptions are not in the list (see TaskService.listTasks), so an entry stays
 * small, and storage failures — a full quota, a blocked window — just mean no cache.
 */
const PREFIX = "gms.tasksCache.v1.";
/** Beyond this the write would crowd out other keys for a speed-up that is no longer cheap. */
const MAX_CHARS = 3_000_000;

export interface CachedProject {
  tasks: Task[];
  users: JiraUser[];
  savedAt: string;
}

export const tasksCacheKey = (cloudId: string, accountId: string, projectKey: string) =>
  `${PREFIX}${cloudId}.${accountId}.${projectKey}`;

export function loadTasksCache(key: string, storage: Pick<Storage, "getItem"> = localStorage): CachedProject | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<CachedProject>;
    if (!Array.isArray(v.tasks) || !Array.isArray(v.users) || typeof v.savedAt !== "string") return null;
    return { tasks: v.tasks, users: v.users, savedAt: v.savedAt };
  } catch {
    return null;
  }
}

export function saveTasksCache(
  key: string,
  tasks: Task[],
  users: JiraUser[],
  storage: Pick<Storage, "setItem" | "removeItem"> = localStorage
): void {
  try {
    const json = JSON.stringify({ tasks, users, savedAt: new Date().toISOString() } satisfies CachedProject);
    if (json.length > MAX_CHARS) storage.removeItem(key);
    else storage.setItem(key, json);
  } catch {
    // Quota or blocked storage: the app works the same, it just opens slower next time.
  }
}

/** Every cached project, for every account — called on logout. */
export function clearTasksCache(storage: Pick<Storage, "length" | "key" | "removeItem"> = localStorage): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) storage.removeItem(k);
  } catch {
    // Nothing to clear if storage is unreachable.
  }
}
