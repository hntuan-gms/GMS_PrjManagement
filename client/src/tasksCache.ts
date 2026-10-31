import { idbStore, type AsyncStore } from "./idbCache";
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
 *
 * A project too big for localStorage (4000 tasks was 2.7 MB, and the SLA timestamps pushed it over the
 * limit — the page then opened blank with nothing to show, on the biggest project exactly) is kept in
 * IndexedDB instead. That read is asynchronous, so the workspace takes it as a second chance
 * (loadBigTasksCache) beside the network instead of waiting on it.
 */
const PREFIX = "gms.tasksCache.v1.";
/**
 * Beyond this a project is kept in IndexedDB instead of localStorage: one write this big would crowd out every
 * other key. (`__GMS_TASKS_CACHE_MAX__` is a test seam, so a small project can take the big-project path.)
 */
const MAX_CHARS: number = (globalThis as { __GMS_TASKS_CACHE_MAX__?: number }).__GMS_TASKS_CACHE_MAX__ ?? 3_000_000;

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

/** The copy of a project too big for localStorage, or null (none, or no IndexedDB). */
export async function loadBigTasksCache(key: string, idb: AsyncStore = idbStore): Promise<CachedProject | null> {
  const v = await idb.get<Partial<CachedProject>>(key);
  if (!v || !Array.isArray(v.tasks) || !Array.isArray(v.users) || typeof v.savedAt !== "string") return null;
  return { tasks: v.tasks, users: v.users, savedAt: v.savedAt };
}

export function saveTasksCache(
  key: string,
  tasks: Task[],
  users: JiraUser[],
  storage: Pick<Storage, "setItem" | "removeItem"> = localStorage,
  idb: AsyncStore = idbStore,
  maxChars: number = MAX_CHARS
): void {
  const entry = { tasks, users, savedAt: new Date().toISOString() } satisfies CachedProject;
  try {
    const json = JSON.stringify(entry);
    if (json.length > maxChars) {
      // Too big for localStorage: no stale small copy left behind, the real one goes to IndexedDB.
      storage.removeItem(key);
      idb.put(key, entry).catch(() => {});
    } else {
      storage.setItem(key, json);
      idb.del(key).catch(() => {});
    }
  } catch {
    // Quota or blocked storage: the app works the same, it just opens slower next time.
  }
}

/** Every cached project, for every account — called on logout. */
export function clearTasksCache(storage: Pick<Storage, "length" | "key" | "removeItem"> = localStorage, idb: AsyncStore = idbStore): void {
  idb.clear().catch(() => {});
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
