/**
 * What the Bảng, Chấm công, Báo cáo and Nguồn lực tabs last showed, kept so reopening a tab
 * paints at once and the fresh answer replaces it when it lands. Each tab is unmounted when
 * you leave it and used to start from nothing, waiting on Jira every time (the Gantt has
 * tasksCache.ts for the same reason).
 *
 * Memory first, and written through to sessionStorage so a reload (F5) paints from it too —
 * before that, only the Gantt survived a reload and every other tab sat blank on Jira. It is
 * sessionStorage, not localStorage, on purpose: these are per-visit conveniences, they should not
 * outlive the tab, and a second person on the same computer starts clean. Keyed by site, ACCOUNT
 * and project like tasksCache — what a person may see depends on their Jira permissions — and
 * cleared on logout (clearViewCache). Storage failures (quota, blocked) just mean memory only.
 */
const MAX_ENTRIES = 40;
/** One entry larger than this is kept in memory only: it would crowd out the others for a speed-up. */
const MAX_CHARS = 1_500_000;
const PREFIX = "gms.viewCache.v1.";
const entries = new Map<string, unknown>();
/**
 * Answers fetched ahead of a visit (warmViews.ts), by the time their request STARTED. A tab that finds one
 * of these still fresh shows it and does not ask again — it would only repeat a read of Jira that began a
 * moment ago. Memory only: after a reload nothing is fresh, so a tab asks as it always did.
 */
const freshSince = new Map<string, number>();
/** When the workspace's tasks last changed under the user (a drag, an edit), per scope. */
const changedAt = new Map<string, number>();
/** An answer older than this is asked for again even if nothing changed: Jira changes without us. */
export const FRESH_MAX_AGE_MS = 60_000;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

function session(): Store | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export const viewCacheScope = (cloudId: string, accountId: string, projectKey: string) =>
  `${cloudId}.${accountId}.${projectKey}`;

const keyOf = (scope: string, view: string, params: string) => `${scope}|${view}|${params}`;

export function readViewCache<T>(scope: string, view: string, params: string, storage: Store | null = session()): T | undefined {
  const key = keyOf(scope, view, params);
  if (entries.has(key)) return entries.get(key) as T;
  try {
    const raw = storage?.getItem(PREFIX + key);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as T;
    entries.set(key, value);
    return value;
  } catch {
    return undefined;
  }
}

export function writeViewCache(scope: string, view: string, params: string, value: unknown, storage: Store | null = session()): void {
  const key = keyOf(scope, view, params);
  // Re-inserted so the oldest entry is the one least recently written; a timesheet range
  // per week visited would otherwise grow without bound.
  entries.delete(key);
  freshSince.delete(key); // a write that is not a warm-up is no longer "the one fetched ahead"
  entries.set(key, value);
  try {
    const json = JSON.stringify(value);
    if (json.length > MAX_CHARS) storage?.removeItem(PREFIX + key);
    else storage?.setItem(PREFIX + key, json);
  } catch {
    // Quota or blocked storage: memory still has it.
  }
  if (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value as string;
    entries.delete(oldest);
    try {
      storage?.removeItem(PREFIX + oldest);
    } catch {
      /* nothing to remove */
    }
  }
}

/** Say the answer just written was fetched ahead, by a request that began at `startedAt`. */
export function markViewFresh(scope: string, view: string, params: string, startedAt: number): void {
  freshSince.set(keyOf(scope, view, params), startedAt);
}

/** The tasks changed under the user: every answer fetched before now describes the old plan. */
export function noteViewsStale(scope: string, now = Date.now()): void {
  changedAt.set(scope, now);
}

/** True while a warmed answer began after the last change to the tasks and is not too old. */
export function isViewFresh(scope: string, view: string, params: string, now = Date.now()): boolean {
  const started = freshSince.get(keyOf(scope, view, params));
  if (started === undefined || now - started > FRESH_MAX_AGE_MS) return false;
  return started > (changedAt.get(scope) ?? 0);
}

/** Forget one answer — for an answer that must not be shown again (a refusal). */
export function dropViewCache(scope: string, view: string, params: string, storage: Store | null = session()): void {
  const key = keyOf(scope, view, params);
  entries.delete(key);
  freshSince.delete(key);
  try {
    storage?.removeItem(PREFIX + key);
  } catch {
    /* nothing to remove */
  }
}

export function clearViewCache(storage: Store | null = session()): void {
  entries.clear();
  freshSince.clear();
  changedAt.clear();
  try {
    if (!storage) return;
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
