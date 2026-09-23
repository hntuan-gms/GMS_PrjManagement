import type { DependencyType, Predecessor, Task } from "./types";

/** UTC-based, matching the server's own addDays convention (see taskService.ts). */
function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Earliest allowed start for a task, given one FS/SS/FF/SF link to another task. */
function earliestStart(
  type: DependencyType,
  otherStart: string,
  otherEnd: string,
  lagDays: number,
  ownDurationDays: number
): string {
  if (type === "FS") return addDays(otherEnd, lagDays + 1);
  if (type === "SS") return addDays(otherStart, lagDays);
  if (type === "FF") return addDays(otherEnd, lagDays - (ownDurationDays - 1));
  return addDays(otherStart, lagDays - (ownDurationDays - 1)); // SF
}

/**
 * Client-side mirror of server/src/taskService.ts's applyDependencyCascade — same
 * ASAP BFS (forward push AND backward pull for a successor with zero slack, see
 * the server's own comment for why that distinction matters), same FS/SS/FF/SF
 * formulas — but pure and synchronous: no Jira writes, no overlay store, nothing
 * awaited. Run immediately after a drag (alongside, not instead of, the real
 * PATCH request) so every task the cascade would move updates on screen the
 * instant the bar is dropped, rather than waiting out the round trip to Jira for
 * each affected successor. The PATCH response remains the source of truth
 * (applyTaskUpdate overwrites these values once it resolves), so a local pass
 * that gets a detail wrong — e.g. a concurrent edit this client hasn't seen yet —
 * self-corrects a moment later instead of sticking.
 */
export function computeOptimisticCascade(
  tasks: Task[],
  changedId: string,
  knownStart: string,
  knownDuration: number
): Map<string, Task> {
  const byId = new Map(tasks.map((t) => [t.id, { ...t } as Task]));
  const primary = byId.get(changedId);
  if (!primary) return new Map();
  // Captured before overwriting: this is changedId's position from an instant
  // ago, needed below to tell a successor that was riding right behind it apart
  // from one that just happens to be later than required.
  const oldStart = primary.startDate;
  const oldDuration = primary.durationDays;
  primary.startDate = knownStart;
  primary.durationDays = knownDuration;
  primary.dueDate = addDays(knownStart, knownDuration - 1);

  const successorsOf = new Map<string, Array<{ taskId: string; pred: Predecessor }>>();
  for (const t of tasks) {
    for (const p of t.predecessors) {
      if (!successorsOf.has(p.taskId)) successorsOf.set(p.taskId, []);
      successorsOf.get(p.taskId)!.push({ taskId: t.id, pred: p });
    }
  }

  // Each task's start/duration the moment before this cascade first touches it.
  const priorState = new Map<string, { start: string; duration: number }>();
  if (oldStart) priorState.set(changedId, { start: oldStart, duration: oldDuration });
  const capturePrior = (t: Task) => {
    if (!priorState.has(t.id) && t.startDate) priorState.set(t.id, { start: t.startDate, duration: t.durationDays });
  };

  const changed = new Map<string, Task>();
  const visited = new Set<string>();
  const queue = [changedId];
  while (queue.length > 0) {
    const curId = queue.shift()!;
    if (visited.has(curId)) continue;
    visited.add(curId);
    const cur = byId.get(curId);
    if (!cur || !cur.startDate) continue;
    capturePrior(cur);

    // Same self-check as the server: before pushing cur's schedule onto its
    // successors, make sure cur's own start doesn't violate its own predecessors.
    // Also the safety net for a tentative backward pull below — see the server.
    let curStart = cur.startDate;
    for (const pred of cur.predecessors) {
      const predTask = byId.get(pred.taskId);
      if (!predTask || !predTask.startDate) continue;
      const predEnd = addDays(predTask.startDate, predTask.durationDays - 1);
      const earliest = earliestStart(pred.type, predTask.startDate, predEnd, pred.lagDays, cur.durationDays);
      if (earliest > curStart) curStart = earliest;
    }
    if (curStart !== cur.startDate) {
      cur.startDate = curStart;
      cur.dueDate = addDays(curStart, cur.durationDays - 1);
      changed.set(cur.id, cur);
    }
    const curEnd = addDays(curStart, cur.durationDays - 1);
    const prior = priorState.get(curId)!;
    const priorEnd = addDays(prior.start, prior.duration - 1);

    for (const { taskId, pred } of successorsOf.get(curId) ?? []) {
      const succ = byId.get(taskId);
      if (!succ || !succ.startDate) continue;
      const newBound = earliestStart(pred.type, curStart, curEnd, pred.lagDays, succ.durationDays);

      let nextStart: string | null = null;
      if (newBound > succ.startDate) {
        nextStart = newBound;
      } else if (newBound < succ.startDate) {
        const oldBound = earliestStart(pred.type, prior.start, priorEnd, pred.lagDays, succ.durationDays);
        if (succ.startDate === oldBound) nextStart = newBound;
      }

      if (nextStart) {
        capturePrior(succ);
        succ.startDate = nextStart;
        succ.dueDate = addDays(nextStart, succ.durationDays - 1);
        changed.set(succ.id, succ);
        queue.push(succ.id);
      }
    }
  }

  changed.set(changedId, primary);
  return changed;
}
