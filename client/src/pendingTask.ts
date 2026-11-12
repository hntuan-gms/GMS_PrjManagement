import type { JiraUser, Task } from "./types";
import { dueFor } from "./scheduleFields";

/*
 * A task that has been asked for but not yet made by Jira. It is drawn at once (a row you can see, dimmed and
 * not yet touchable) and swapped for the real one when Jira answers, or removed when Jira refuses. Pure, so
 * the shape is tested without a browser.
 */

let counter = 0;

/** A key no Jira project can have, so it never collides with a real task. */
export function nextPendingId(): string {
  counter += 1;
  return `NEW-${counter}`;
}

export function isPendingId(id: string): boolean {
  return /^NEW-\d+$/.test(id);
}

export interface PendingInput {
  id: string;
  summary: string;
  issueType: string;
  parentId: string | null;
  startDate: string | null;
  durationDays: number;
  assignee: JiraUser | null;
  priority: string | null;
  labels: string[];
  estimateHours: number | null;
  jiraUrl?: string;
}

export function pendingTask(i: PendingInput): Task {
  const duration = Math.max(1, Math.ceil(i.durationDays));
  const due = i.startDate ? dueFor(i.startDate, duration) : "";
  return {
    id: i.id,
    wbsParentId: i.parentId,
    summary: i.summary,
    description: null,
    issueType: i.issueType as Task["issueType"],
    statusName: "To Do",
    statusCategory: "new",
    assigneeAccountId: i.assignee?.accountId ?? null,
    assigneeName: i.assignee?.displayName ?? null,
    assigneeAvatarUrl: i.assignee?.avatarUrl ?? null,
    startDate: i.startDate,
    dueDate: due || null,
    durationDays: duration,
    percentComplete: 0,
    predecessors: [],
    baselineStart: null,
    baselineDue: null,
    estimateHours: i.estimateHours,
    spentHours: null,
    priority: i.priority,
    labels: i.labels,
    components: [],
    fixVersions: [],
    sprint: null,
    createdAt: null,
    resolvedAt: null,
    jiraUrl: i.jiraUrl ?? "",
    pending: true,
  };
}

/** `tasks` with the pending row `tempId` replaced by what Jira made; added when a re-read already dropped the row. */
export function settlePending(tasks: Task[], tempId: string, created: Task): Task[] {
  if (tasks.some((t) => t.id === tempId)) return tasks.map((t) => (t.id === tempId ? created : t));
  return tasks.some((t) => t.id === created.id) ? tasks : [...tasks, created];
}

/** `tasks` without the pending row (Jira refused it). */
export function dropPending(tasks: Task[], tempId: string): Task[] {
  return tasks.filter((t) => t.id !== tempId);
}
