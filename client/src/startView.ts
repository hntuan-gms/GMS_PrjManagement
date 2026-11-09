/**
 * Which screen a project opens on. The last view used is remembered per project, but only for a
 * while: come back after a break and the workspace starts on the plan (List) again, like a fresh day, while
 * an F5 in the middle of work (or a quick return) still lands where you were.
 */
export const LAST_ACTIVE_KEY = "gms.lastActive";
/** How long the remembered view stays valid after the page was last used. */
export const VIEW_MEMORY_MS = 30 * 60 * 1000;

/** True when the page was last used longer ago than `ttl`. No stamp at all is not stale: nothing was remembered. */
export function isStale(lastActiveMs: number | null, nowMs: number, ttl: number = VIEW_MEMORY_MS): boolean {
  if (lastActiveMs === null || !Number.isFinite(lastActiveMs)) return false;
  return nowMs - lastActiveMs > ttl;
}

export function readLastActive(): number | null {
  try {
    const raw = localStorage.getItem(LAST_ACTIVE_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function touchLastActive(nowMs: number = Date.now()): void {
  try {
    localStorage.setItem(LAST_ACTIVE_KEY, String(nowMs));
  } catch {
    /* private mode: the saved view just never expires */
  }
}
