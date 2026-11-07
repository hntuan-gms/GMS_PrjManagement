import type { Predecessor, Task } from "./types";

/*
 * What a typed predecessor list may not do (plan C5): point at a task that is not in the project, at the
 * task itself, or close a loop. The server's cascade would chase its own tail on a loop; the assistant's
 * add_dependency refuses one with the same walk (reaches over predecessors).
 */

type Node = Pick<Task, "id" | "predecessors">;

/** True when walking predecessors from `from` reaches `target`. */
export function reaches(byId: Map<string, Node>, from: string, target: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const p of byId.get(id)?.predecessors ?? []) stack.push(p.taskId);
  }
  return false;
}

/** The first problem with giving `taskId` this predecessor list, as a sentence; null when it is fine. */
export function predecessorProblem(tasks: readonly Node[], taskId: string, next: readonly Predecessor[]): string | null {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const p of next) {
    if (p.taskId === taskId) return `${taskId} không thể phụ thuộc chính nó.`;
    if (!byId.has(p.taskId)) return `Không có việc ${p.taskId} trong dự án.`;
  }
  // A loop exists when one of the new predecessors already depends (however far back) on this task.
  for (const p of next) {
    if (reaches(byId, p.taskId, taskId)) return `${p.taskId} đã phụ thuộc ${taskId}: nối thế này thành vòng.`;
  }
  return null;
}
