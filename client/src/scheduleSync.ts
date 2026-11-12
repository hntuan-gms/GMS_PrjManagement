/**
 * What the screen wants of Jira, as a difference.
 *
 * A drag, the % handle and undo change the plan on screen at once; Jira is made to follow. Writing each action
 * in turn made the work pile up (a save takes seconds, nine drags and nine undos were eighteen saves) and gave
 * the page a long tail that a reload cut off. Instead the page keeps two small maps per touched task:
 *  - `confirmed`: what Jira is known to hold (the values before the first change, then each answer);
 *  - `wanted`: what the screen shows now.
 * Whatever differs is what still has to be written, and only that: a drag that was undone before it was saved
 * is nothing to write at all. Pure functions here; the loop and the network are in ProjectWorkspace.
 */
import type { Task } from "./types";

export interface Sched {
  startDate: string | null;
  durationDays: number;
  percentComplete: number;
}

export interface SyncPatch {
  startDate?: string | null;
  durationDays?: number;
  percentComplete?: number;
}

export interface SyncOp {
  id: string;
  patch: SyncPatch;
}

export const schedOf = (t: Pick<Task, "startDate" | "durationDays" | "percentComplete">): Sched => ({
  startDate: t.startDate,
  durationDays: t.durationDays,
  percentComplete: t.percentComplete,
});

export const sameSched = (a: Sched, b: Sched): boolean =>
  a.startDate === b.startDate && a.durationDays === b.durationDays && a.percentComplete === b.percentComplete;

/**
 * What to send to take Jira from `confirmed` to `wanted`, or null when they agree. The two schedule fields
 * travel together (the server derives the due date from start + duration), the percentage on its own.
 */
export function patchBetween(confirmed: Sched, wanted: Sched): SyncPatch | null {
  const patch: SyncPatch = {};
  if (confirmed.startDate !== wanted.startDate || confirmed.durationDays !== wanted.durationDays) {
    patch.startDate = wanted.startDate;
    patch.durationDays = wanted.durationDays;
  }
  if (confirmed.percentComplete !== wanted.percentComplete) patch.percentComplete = wanted.percentComplete;
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Every task whose wanted values differ from what Jira holds, a task before the ones that come after it in the
 * dependency graph. Writing a predecessor first lets the server's cascade move (or pull back) its successors
 * itself, and those then often need no write of their own. Ties keep the order in `wanted` (the order the
 * person made them in). A cycle cannot be ordered and is simply kept in that order.
 */
export function pendingOps(confirmed: ReadonlyMap<string, Sched>, wanted: ReadonlyMap<string, Sched>, tasks: readonly Task[]): SyncOp[] {
  const ops: SyncOp[] = [];
  for (const [id, w] of wanted) {
    const c = confirmed.get(id);
    if (!c) continue;
    const patch = patchBetween(c, w);
    if (patch) ops.push({ id, patch });
  }
  if (ops.length < 2) return ops;

  const preds = new Map<string, string[]>();
  for (const t of tasks) preds.set(t.id, t.predecessors.map((p) => p.taskId));
  const pending = new Set(ops.map((o) => o.id));
  /** The pending tasks that `id` comes after, however far back in the graph. */
  const before = new Map<string, Set<string>>();
  function ancestorsOf(id: string): Set<string> {
    const found = new Set<string>();
    const seen = new Set<string>([id]);
    const stack = [...(preds.get(id) ?? [])];
    while (stack.length > 0) {
      const p = stack.pop()!;
      if (seen.has(p)) continue;
      seen.add(p);
      if (pending.has(p)) found.add(p);
      stack.push(...(preds.get(p) ?? []));
    }
    return found;
  }
  for (const o of ops) before.set(o.id, ancestorsOf(o.id));

  const ordered: SyncOp[] = [];
  const left = [...ops];
  while (left.length > 0) {
    const i = left.findIndex((o) => [...(before.get(o.id) ?? [])].every((a) => !left.some((x) => x.id === a)));
    ordered.push(...left.splice(i === -1 ? 0 : i, 1));
  }
  return ordered;
}
