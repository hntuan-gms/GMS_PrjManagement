import type { Task } from "./types";

const MS_PER_DAY = 86_400_000;

function toDayNum(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

/** Earliest allowed start of a dependent task given one predecessor's (ES, EF) —
 * the same FS/SS/FF/SF/lag formulas as the server's applyDependencyCascade, so the
 * two stay consistent. */
function earliestStart(
  type: Task["predecessors"][number]["type"],
  lagDays: number,
  predEs: number,
  predEf: number,
  ownDuration: number
): number {
  switch (type) {
    case "FS":
      return predEf + lagDays + 1;
    case "SS":
      return predEs + lagDays;
    case "FF":
      return predEf + lagDays - (ownDuration - 1);
    case "SF":
      return predEs + lagDays - (ownDuration - 1);
  }
}

/** The mirror-image bound on a predecessor's latest finish, given a successor's
 * already-resolved (LS, LF): solve the forward formula above for the predecessor's
 * ES/EF, then substitute the successor's LATE value for its EARLY one. */
function latestFinishBound(
  type: Task["predecessors"][number]["type"],
  lagDays: number,
  succLs: number,
  succLf: number,
  predDuration: number
): number {
  switch (type) {
    case "FS":
      return succLs - lagDays - 1;
    case "SS":
      return succLs - lagDays + predDuration - 1;
    case "FF":
      return succLf - lagDays;
    case "SF":
      return succLf - lagDays + predDuration - 1;
  }
}

/**
 * Classic CPM (forward + backward pass) over the existing FS/SS/FF/SF predecessor
 * graph, restricted to tasks that have their own startDate (matching the schedule
 * cascade's own filter). A task's own persisted start is used as the floor for its
 * early start — not just a theoretical dependency-only minimum — so "critical"
 * reflects the schedule as it's actually set, the same way MS Project's critical
 * path does, rather than an idealized earliest-possible plan.
 *
 * Returns the set of task ids with zero (or negative — already behind) float.
 * A dependency cycle, if one ever gets created (nothing currently prevents it),
 * is excluded from the result rather than looped on forever.
 */
export function computeCriticalPath(tasks: Task[]): Set<string> {
  const scheduled = tasks.filter((t) => t.startDate);
  const byId = new Map(scheduled.map((t) => [t.id, t]));
  const ids = new Set(byId.keys());
  if (ids.size === 0) return new Set();

  const predsOf = new Map<string, Task["predecessors"]>();
  const succsOf = new Map<string, string[]>();
  for (const t of scheduled) {
    const valid = t.predecessors.filter((p) => ids.has(p.taskId) && p.taskId !== t.id);
    predsOf.set(t.id, valid);
    for (const p of valid) {
      if (!succsOf.has(p.taskId)) succsOf.set(p.taskId, []);
      succsOf.get(p.taskId)!.push(t.id);
    }
  }

  // Kahn's topological sort; any ids left over after the queue drains sit on a
  // cycle and are dropped from CPM.
  const inDegree = new Map<string, number>();
  for (const id of ids) inDegree.set(id, predsOf.get(id)!.length);
  const queue: string[] = [...ids].filter((id) => inDegree.get(id) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const succId of succsOf.get(id) ?? []) {
      inDegree.set(succId, inDegree.get(succId)! - 1);
      if (inDegree.get(succId) === 0) queue.push(succId);
    }
  }
  const acyclic = new Set(order);
  if (acyclic.size === 0) return new Set();

  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  for (const id of order) {
    const t = byId.get(id)!;
    let start = toDayNum(t.startDate!);
    for (const p of predsOf.get(id)!) {
      if (!acyclic.has(p.taskId)) continue;
      const bound = earliestStart(p.type, p.lagDays, es.get(p.taskId)!, ef.get(p.taskId)!, t.durationDays);
      if (bound > start) start = bound;
    }
    es.set(id, start);
    ef.set(id, start + t.durationDays - 1);
  }

  const projectEnd = Math.max(...[...acyclic].map((id) => ef.get(id)!));

  const lf = new Map<string, number>();
  const ls = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const t = byId.get(id)!;
    let finish = projectEnd;
    for (const succId of succsOf.get(id) ?? []) {
      if (!acyclic.has(succId)) continue;
      const edge = predsOf.get(succId)!.find((p) => p.taskId === id)!;
      const bound = latestFinishBound(edge.type, edge.lagDays, ls.get(succId)!, lf.get(succId)!, t.durationDays);
      if (bound < finish) finish = bound;
    }
    lf.set(id, finish);
    ls.set(id, finish - t.durationDays + 1);
  }

  const critical = new Set<string>();
  for (const id of acyclic) {
    if (ls.get(id)! - es.get(id)! <= 0) critical.add(id);
  }
  return critical;
}
