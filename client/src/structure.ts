import type { Task } from "./types";

/**
 * Which parents and types the edit modal offers for a task. A mirror of the rules in
 * server/src/structure.ts — the server stays the authority and refuses the rest; this
 * only avoids offering a choice that would be refused. Change one, change both.
 */

export interface TypeInfo {
  name: string;
  subtask: boolean;
}

const isEpic = (name: string) => name.toLowerCase() === "epic";

/** Ids of everything beneath `id` at any depth. */
export function descendantsOf(tasks: Task[], id: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const t of tasks) {
    if (!t.wbsParentId) continue;
    const list = childrenOf.get(t.wbsParentId) ?? [];
    list.push(t.id);
    childrenOf.set(t.wbsParentId, list);
  }
  const out = new Set<string>();
  const stack = [...(childrenOf.get(id) ?? [])];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (out.has(cur)) continue; // also stops a malformed loop
    out.add(cur);
    stack.push(...(childrenOf.get(cur) ?? []));
  }
  return out;
}

/**
 * Tasks that may become `task`'s parent when it is of type `typeName`: not itself, not
 * anything beneath it, never a Sub-task; and an Epic has no parent at all.
 */
export function parentOptions(tasks: Task[], task: Task, types: TypeInfo[], typeName: string = task.issueType): Task[] {
  if (isEpic(typeName)) return [];
  const below = descendantsOf(tasks, task.id);
  const subtaskNames = new Set(types.filter((t) => t.subtask).map((t) => t.name.toLowerCase()));
  return tasks.filter(
    (t) => t.id !== task.id && !below.has(t.id) && !subtaskNames.has(t.issueType.toLowerCase())
  );
}

/** Why `type` cannot be picked for `task`, or null when it can. */
export function typeBlockedReason(tasks: Task[], task: Task, type: TypeInfo): string | null {
  if (type.name.toLowerCase() === task.issueType.toLowerCase()) return null;
  if (type.subtask && tasks.some((t) => t.wbsParentId === task.id)) return "đang có việc con";
  if (isEpic(type.name) && task.assigneeAccountId) return "đang có người phụ trách";
  return null;
}
