import type { ActivityEntry, TaskComment } from "../taskActivity.js";
import type { Task } from "../types.js";
import { mentionsToPlain } from "./mentionText.js";

/**
 * "Task này đang vướng gì?" — everything the answer needs, gathered and
 * measured here, so the model only has to read it and say what it means.
 *
 * The split is the rest of the app's: code computes every number and flags every
 * fact ("quá hạn 3 ngày", "đang chờ GPM-3 chưa xong", "12 ngày không có thay
 * đổi"); the model interprets them and may not invent others. `signals` is that
 * list of facts in plain Vietnamese, in rough order of how much they matter.
 */

const DESCRIPTION_CHARS = 1500;
const COMMENT_CHARS = 500;
const COMMENTS_SHOWN = 5;
const CHANGES_SHOWN = 8;

export interface TaskDigest {
  task: {
    id: string;
    summary: string;
    type: string;
    status: string;
    assignee: string | null;
    priority: string | null;
    labels: string[];
    start: string | null;
    due: string | null;
    percentComplete: number;
    description: string | null;
    jiraUrl: string;
  };
  schedule: { overdueDays: number | null; daysLeft: number | null };
  blockedBy: Array<{ id: string; summary: string; status: string; assignee: string | null; due: string | null; lateDays: number | null }>;
  blocking: Array<{ id: string; summary: string; status: string; assignee: string | null }>;
  children: { total: number; done: number; open: string[] } | null;
  effort: { estimateHours: number | null; spentHours: number | null; remainingHours: number | null; overEstimate: boolean };
  activity: {
    total: number;
    lastChangeAt: string | null;
    daysSinceLastChange: number | null;
    lastStatusChange: { from: string | null; to: string | null; at: string; by: string } | null;
    recent: Array<{ at: string; by: string; changes: string[] }>;
  };
  comments: {
    total: number;
    daysSinceLast: number | null;
    latest: Array<{ author: string; at: string; text: string }>;
  };
  signals: string[];
}

/** Whole calendar days from `a` to `b` (both ISO dates or datetimes), by their date part. */
export function daysBetween(a: string, b: string): number {
  const ms = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Math.round((ms(b) - ms(a)) / 86_400_000);
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function buildTaskDigest(input: {
  task: Task;
  tasks: Task[];
  comments: TaskComment[];
  /** Newest first, as TaskActivity.listActivity returns it. */
  activity: ActivityEntry[];
  today: string;
}): TaskDigest {
  const { task: t, tasks, comments, activity, today } = input;
  const byId = new Map(tasks.map((x) => [x.id, x]));
  const open = t.statusCategory !== "done";
  const signals: string[] = [];

  /* schedule */
  const overdueDays = open && t.dueDate && t.dueDate < today ? daysBetween(t.dueDate, today) : null;
  const daysLeft = open && t.dueDate && t.dueDate >= today ? daysBetween(today, t.dueDate) : null;
  if (overdueDays !== null) signals.push(`Quá hạn ${overdueDays} ngày (hạn ${t.dueDate}).`);
  else if (daysLeft !== null && daysLeft <= 2) signals.push(daysLeft === 0 ? "Hạn là hôm nay." : `Còn ${daysLeft} ngày đến hạn (${t.dueDate}).`);
  if (open && !t.startDate) signals.push("Chưa có ngày bắt đầu nên không nằm trên Gantt.");
  if (open && t.startDate && t.startDate <= today && t.statusCategory === "new") {
    signals.push(`Đến hạn bắt đầu từ ${t.startDate} nhưng vẫn ở trạng thái "${t.statusName}".`);
  }
  if (open && !t.assigneeAccountId) signals.push("Chưa có người phụ trách.");

  /* dependencies — only unfinished predecessors are blockers */
  const blockedBy = t.predecessors
    .map((p) => ({ p, pred: byId.get(p.taskId) }))
    .filter((x): x is { p: Task["predecessors"][number]; pred: Task } => !!x.pred && x.pred.statusCategory !== "done")
    .map(({ pred }) => ({
      id: pred.id,
      summary: pred.summary,
      status: pred.statusName,
      assignee: pred.assigneeName,
      due: pred.dueDate,
      lateDays: pred.dueDate && pred.dueDate < today ? daysBetween(pred.dueDate, today) : null,
    }));
  if (open) {
    for (const b of blockedBy) {
      signals.push(
        `Đang chờ ${b.id} "${b.summary}" (${b.status}${b.assignee ? `, ${b.assignee}` : ", chưa có người"})` +
          (b.lateDays !== null ? ` — việc này đã trễ ${b.lateDays} ngày.` : ".")
      );
    }
  }
  const blocking = tasks
    .filter((x) => x.predecessors.some((p) => p.taskId === t.id) && x.statusCategory !== "done")
    .map((x) => ({ id: x.id, summary: x.summary, status: x.statusName, assignee: x.assigneeName }));
  if (open && blocking.length > 0) signals.push(`${blocking.length} việc đang chờ việc này: ${blocking.map((b) => b.id).join(", ")}.`);

  /* children */
  const kids = tasks.filter((x) => x.wbsParentId === t.id);
  const children =
    kids.length > 0
      ? {
          total: kids.length,
          done: kids.filter((k) => k.statusCategory === "done").length,
          open: kids.filter((k) => k.statusCategory !== "done").map((k) => k.id),
        }
      : null;
  if (children && open && children.done < children.total) signals.push(`${children.done}/${children.total} việc con đã xong.`);

  /* effort */
  const estimate = t.estimateHours;
  const spent = t.spentHours;
  const remaining = estimate != null && spent != null ? Math.round((estimate - spent) * 10) / 10 : null;
  const overEstimate = estimate != null && spent != null && spent > estimate;
  if (overEstimate) signals.push(`Đã ghi ${spent}h, vượt ước lượng ${estimate}h.`);

  /* history */
  const newest = activity[0] ?? null;
  const daysSinceLastChange = newest ? daysBetween(newest.created, today) : null;
  const statusChange = activity.find((e) => e.changes.some((c) => c.field.toLowerCase() === "status"));
  const lastStatusChange = statusChange
    ? (() => {
        const c = statusChange.changes.find((x) => x.field.toLowerCase() === "status")!;
        return { from: c.from, to: c.to, at: statusChange.created, by: statusChange.authorName };
      })()
    : null;
  if (open && t.statusCategory === "indeterminate" && daysSinceLastChange !== null && daysSinceLastChange >= 3) {
    signals.push(`Đang làm nhưng ${daysSinceLastChange} ngày chưa có thay đổi nào.`);
  }

  /* comments (Jira returns newest first) */
  const sorted = [...comments].sort((a, b) => b.created.localeCompare(a.created));
  const daysSinceComment = sorted[0] ? daysBetween(sorted[0].created, today) : null;

  return {
    task: {
      id: t.id,
      summary: t.summary,
      type: t.issueType,
      status: t.statusName,
      assignee: t.assigneeName,
      priority: t.priority,
      labels: t.labels,
      start: t.startDate,
      due: t.dueDate,
      percentComplete: t.percentComplete,
      description: t.description ? clip(t.description, DESCRIPTION_CHARS) : null,
      jiraUrl: t.jiraUrl,
    },
    schedule: { overdueDays, daysLeft },
    blockedBy,
    blocking,
    children,
    effort: { estimateHours: estimate, spentHours: spent, remainingHours: remaining, overEstimate },
    activity: {
      total: activity.length,
      lastChangeAt: newest?.created ?? null,
      daysSinceLastChange,
      lastStatusChange,
      recent: activity.slice(0, CHANGES_SHOWN).map((e) => ({
        at: e.created,
        by: e.authorName,
        changes: e.changes.map((c) => `${c.field}: ${c.from ?? "—"} → ${c.to ?? "—"}`),
      })),
    },
    comments: {
      total: comments.length,
      daysSinceLast: daysSinceComment,
      latest: sorted.slice(0, COMMENTS_SHOWN).map((c) => ({
        author: c.authorName,
        at: c.created,
        text: clip(mentionsToPlain(c.text), COMMENT_CHARS),
      })),
    },
    signals,
  };
}
