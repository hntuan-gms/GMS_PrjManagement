/**
 * What was still waiting when the page closed, kept for the next one.
 *
 * On the way out the page sends what is left to the server in one request (api.sendScheduleBatchOnExit) and Jira
 * is written to behind it, which takes seconds. A page opened in that window reads Jira half-way (log of
 * 2026-11-12: GPM-315 shown at 26/11 while the batch was about to put it at 08/12) and the person works from a
 * screen that is wrong. So the same list is also written here, and the next page of the same site, account and
 * project draws it over what it reads, until Jira catches up. It is a picture of what the person already saw and
 * decided, not new data: absolute values, a few minutes of life, never shared across accounts (the key names the
 * account), and the server has the batch regardless.
 *
 * Pure apart from the storage handed in, so it can be tested.
 */
import { addDays } from "./resourceAllocation";
import type { SyncOp } from "./scheduleSync";
import type { Task } from "./types";

export const OUTBOX_PREFIX = "gms.outbox.v1.";
/** Older than this it is not what the person last saw; it is dropped unread. */
export const OUTBOX_MAX_AGE_MS = 3 * 60_000;

export const outboxKey = (tasksCacheKey: string) => `${OUTBOX_PREFIX}${tasksCacheKey}`;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const defaultStore = (): Store | null => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

export function saveOutbox(key: string, ops: SyncOp[], now: number, storage: Store | null = defaultStore()): void {
  try {
    if (!storage) return;
    if (ops.length === 0) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify({ at: now, ops }));
  } catch {
    // Storage full or blocked: the server still has the batch.
  }
}

export function clearOutbox(key: string, storage: Store | null = defaultStore()): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Nothing to do.
  }
}

/** The list saved at the last exit, or null when there is none, it is too old, or it is not what we wrote. */
export function loadOutbox(key: string, now: number, storage: Store | null = defaultStore()): SyncOp[] | null {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as { at?: unknown; ops?: unknown };
    if (typeof v.at !== "number" || !Array.isArray(v.ops)) return null;
    if (now - v.at > OUTBOX_MAX_AGE_MS || now < v.at - 60_000) return null;
    const ops = v.ops.filter((o): o is SyncOp => {
      const op = o as SyncOp | null;
      return !!op && typeof op.id === "string" && !!op.patch && typeof op.patch === "object";
    });
    return ops.length > 0 ? ops : null;
  } catch {
    return null;
  }
}

/**
 * `tasks` with the ops drawn on them: start, duration, percentage and the due date that follows from them. A task
 * no op names is the same object, so nothing else re-renders.
 */
export function applyOps(tasks: Task[], ops: readonly SyncOp[]): Task[] {
  if (ops.length === 0) return tasks;
  const byId = new Map(ops.map((o) => [o.id, o.patch]));
  return tasks.map((t) => {
    const p = byId.get(t.id);
    if (!p) return t;
    const startDate = "startDate" in p ? (p.startDate ?? null) : t.startDate;
    const durationDays = p.durationDays ?? t.durationDays;
    return {
      ...t,
      startDate,
      durationDays,
      percentComplete: p.percentComplete ?? t.percentComplete,
      dueDate: startDate ? addDays(startDate, durationDays - 1) : t.dueDate,
    };
  });
}
