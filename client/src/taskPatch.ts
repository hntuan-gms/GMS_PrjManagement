import type { JiraUser, Task, TaskUpdateInput } from "./types";
import { dueFor } from "./scheduleFields";

/**
 * What a field edit looks like on the task BEFORE Jira has answered, so the panel (and the plan behind
 * it) shows the new value the moment it is typed. The server's answer replaces it; a refusal puts back
 * `restoreFields` from the task as it was. Pure, so it is tested without a browser.
 *
 * `extra` carries what the patch alone cannot say: a status move names a transition, and only the panel
 * knows which status that goes to.
 */
export function optimisticTask(task: Task, patch: TaskUpdateInput, users: readonly JiraUser[], extra: Partial<Task> = {}): Task {
  const next: Task = { ...task };
  if (patch.summary !== undefined) next.summary = patch.summary;
  if (patch.description !== undefined) next.description = patch.description;
  if (patch.startDate !== undefined) next.startDate = patch.startDate;
  if (patch.durationDays !== undefined) next.durationDays = Math.max(1, Math.ceil(patch.durationDays));
  if (patch.startDate !== undefined || patch.durationDays !== undefined) {
    const due = dueFor(next.startDate ?? "", next.durationDays);
    if (due) next.dueDate = due;
  }
  if (patch.dueDate !== undefined) next.dueDate = patch.dueDate;
  if (patch.percentComplete !== undefined) next.percentComplete = patch.percentComplete;
  if (patch.assigneeAccountId !== undefined) {
    next.assigneeAccountId = patch.assigneeAccountId;
    const u = patch.assigneeAccountId ? users.find((x) => x.accountId === patch.assigneeAccountId) : undefined;
    next.assigneeName = u?.displayName ?? null;
    next.assigneeAvatarUrl = u?.avatarUrl ?? null;
  }
  if (patch.predecessors !== undefined) next.predecessors = patch.predecessors;
  if (patch.baselineStart !== undefined) next.baselineStart = patch.baselineStart;
  if (patch.baselineDue !== undefined) next.baselineDue = patch.baselineDue;
  if (patch.estimateHours !== undefined) next.estimateHours = patch.estimateHours;
  if (patch.priority !== undefined) next.priority = patch.priority;
  if (patch.labels !== undefined) next.labels = patch.labels;
  if (patch.components !== undefined) next.components = patch.components;
  if (patch.fixVersions !== undefined) next.fixVersions = patch.fixVersions;
  if (patch.parentKey !== undefined) next.wbsParentId = patch.parentKey;
  if (patch.issueType !== undefined) next.issueType = patch.issueType as Task["issueType"];
  return { ...next, ...extra };
}

/** Which task fields a patch (plus `extra`) can change: what a refused save has to put back. */
export function touchedFields(patch: TaskUpdateInput, extra: Partial<Task> = {}): Array<keyof Task> {
  const keys = new Set<keyof Task>(Object.keys(extra) as Array<keyof Task>);
  if (patch.summary !== undefined) keys.add("summary");
  if (patch.description !== undefined) keys.add("description");
  if (patch.startDate !== undefined || patch.durationDays !== undefined || patch.dueDate !== undefined) {
    keys.add("startDate").add("durationDays").add("dueDate");
  }
  if (patch.percentComplete !== undefined) keys.add("percentComplete");
  if (patch.assigneeAccountId !== undefined) keys.add("assigneeAccountId").add("assigneeName").add("assigneeAvatarUrl");
  if (patch.predecessors !== undefined) keys.add("predecessors");
  if (patch.baselineStart !== undefined) keys.add("baselineStart");
  if (patch.baselineDue !== undefined) keys.add("baselineDue");
  if (patch.estimateHours !== undefined) keys.add("estimateHours");
  if (patch.priority !== undefined) keys.add("priority");
  if (patch.labels !== undefined) keys.add("labels");
  if (patch.components !== undefined) keys.add("components");
  if (patch.fixVersions !== undefined) keys.add("fixVersions");
  if (patch.parentKey !== undefined) keys.add("wbsParentId");
  if (patch.issueType !== undefined) keys.add("issueType");
  return [...keys];
}

/** `task` with `fields` taken from `before` — the undo of an optimistic edit that Jira refused. */
export function restoreFields(task: Task, before: Task, fields: Array<keyof Task>): Task {
  const next = { ...task } as Record<string, unknown>;
  for (const f of fields) next[f] = before[f];
  return next as unknown as Task;
}
