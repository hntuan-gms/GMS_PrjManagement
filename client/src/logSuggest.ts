import { localDate } from "./boardModel";
import { isAssignableType, type Task } from "./types";

/*
 * "Ghi giờ hôm nay" (plan 6.9): a first draft of today's worklogs, so logging time is checking numbers
 * rather than remembering what one did. It is a suggestion built from what the person touched — the sheet
 * says so ("không phải đo thời gian thật") — and nothing is logged until they press "Ghi tất cả".
 *
 * The hours left in the day (capacity − already logged) are shared out by weight:
 *   3  "đang làm"       — in progress and assigned to me
 *   2  "đổi trạng thái" — touched today and resolved today (the only status change the Task carries)
 *   1  "có cập nhật"    — touched today otherwise (an edit, a comment)
 * A task takes the highest weight that applies. Pure, React-free and tested.
 */

export type LogReason = "đang làm" | "đổi trạng thái" | "có cập nhật";

export interface LogSuggestion {
  taskId: string;
  hours: number;
  reason: LogReason;
}

const WEIGHT: Record<LogReason, number> = { "đang làm": 3, "đổi trạng thái": 2, "có cập nhật": 1 };

/** Why (and whether) a task belongs on today's sheet. */
function reasonFor(t: Task, meAccountId: string, today: string, touched: ReadonlySet<string>): LogReason | null {
  if (t.assigneeAccountId === meAccountId && t.statusCategory === "indeterminate") return "đang làm";
  if (!touched.has(t.id)) return null;
  // resolvedAt is a Jira datetime; its calendar day is the browser's (local getters, BUG-04).
  if (t.resolvedAt && localDate(t.resolvedAt) === today) return "đổi trạng thái";
  return "có cập nhật";
}

/**
 * Splits the hours left today across the tasks worth logging, in half-hour steps. Rounding is the largest
 * remainder method over half-hour units, so the total is the remainder rounded down to a half hour — never
 * more than is left, and not a half hour less than it either (rounding each share on its own can do both).
 * Tasks whose share rounds to zero are dropped. Sorted by weight, then by how the tasks were given.
 */
export function suggestWorklogs(
  tasks: Task[],
  meAccountId: string,
  today: string,
  capacityHours: number,
  alreadyLoggedHours: number,
  touched: ReadonlySet<string>
): LogSuggestion[] {
  const remaining = Math.max(0, capacityHours - alreadyLoggedHours);
  const units = Math.floor(remaining * 2 + 1e-9);
  const picked: Array<{ task: Task; reason: LogReason; weight: number; order: number }> = [];
  tasks.forEach((task, order) => {
    if (!isAssignableType(task.issueType)) return; // an Epic is a container; time goes on the work under it
    const reason = reasonFor(task, meAccountId, today, touched);
    if (reason) picked.push({ task, reason, weight: WEIGHT[reason], order });
  });
  if (units === 0 || picked.length === 0) return [];

  const totalWeight = picked.reduce((s, p) => s + p.weight, 0);
  const shares = picked.map((p) => {
    const exact = (units * p.weight) / totalWeight;
    return { ...p, units: Math.floor(exact), frac: exact - Math.floor(exact) };
  });
  let left = units - shares.reduce((s, x) => s + x.units, 0);
  const byRemainder = [...shares].sort((a, b) => b.frac - a.frac || b.weight - a.weight || a.order - b.order);
  for (const s of byRemainder) {
    if (left <= 0) break;
    s.units += 1;
    left -= 1;
  }

  return shares
    .filter((s) => s.units > 0)
    .sort((a, b) => b.weight - a.weight || a.order - b.order)
    .map((s) => ({ taskId: s.task.id, hours: s.units / 2, reason: s.reason }));
}
