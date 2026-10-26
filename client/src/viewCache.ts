/**
 * What the Bảng, Chấm công and Báo cáo tabs last showed, kept in memory so reopening a tab
 * paints at once and the fresh answer replaces it when it lands. Each tab is unmounted when
 * you leave it and used to start from nothing, waiting on Jira every time (the Gantt has
 * tasksCache.ts for the same reason).
 *
 * In memory only, not localStorage: these are per-visit conveniences, and a reload simply
 * asks again. Keyed by site, ACCOUNT and project like tasksCache — what a person may see
 * depends on their Jira permissions — and cleared on logout (clearViewCache).
 */
const MAX_ENTRIES = 40;
const entries = new Map<string, unknown>();

export const viewCacheScope = (cloudId: string, accountId: string, projectKey: string) =>
  `${cloudId}.${accountId}.${projectKey}`;

const keyOf = (scope: string, view: string, params: string) => `${scope}|${view}|${params}`;

export function readViewCache<T>(scope: string, view: string, params: string): T | undefined {
  return entries.get(keyOf(scope, view, params)) as T | undefined;
}

export function writeViewCache(scope: string, view: string, params: string, value: unknown): void {
  const key = keyOf(scope, view, params);
  // Re-inserted so the oldest entry is the one least recently written; a timesheet range
  // per week visited would otherwise grow without bound.
  entries.delete(key);
  entries.set(key, value);
  if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value as string);
}

export function clearViewCache(): void {
  entries.clear();
}
