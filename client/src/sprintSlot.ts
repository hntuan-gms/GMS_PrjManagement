import { addDaysLocal, localDate } from "./boardModel";
import type { Sprint, Task } from "./types";

/**
 * Where a task with no dates would sit if it were placed in a sprint (plan G7): it starts on the
 * sprint's first day, or today when the sprint is already running, and lasts its estimate in
 * 8-hour days (one day when nobody estimated it). Pure so the rule is tested; nothing is written
 * until the person presses "Xếp" on the toast.
 */

export interface SprintSlot {
  startDate: string;
  durationDays: number;
  /** The sprint's own dates, for the sentence ("Xếp DEMO-9 vào 02/11–16/11?"). */
  sprintStart: string;
  sprintEnd: string;
}

export function sprintSlot(
  task: Pick<Task, "startDate" | "estimateHours">,
  sprint: Pick<Sprint, "state" | "startDate" | "endDate">,
  today: string
): SprintSlot | null {
  if (task.startDate) return null;
  const sprintStart = localDate(sprint.startDate);
  const sprintEnd = localDate(sprint.endDate);
  if (!sprintStart || !sprintEnd) return null;
  const startDate = sprint.state === "active" && today > sprintStart ? today : sprintStart;
  const hours = task.estimateHours ?? 0;
  const durationDays = hours > 0 ? Math.max(1, Math.ceil(hours / 8)) : 1;
  // A start already past the sprint's end would put the task outside it; use the last day instead.
  return { startDate: startDate > sprintEnd ? sprintEnd : startDate, durationDays, sprintStart, sprintEnd };
}

/** Last day the slot covers (inclusive): start + duration − 1. */
export function slotEnd(slot: Pick<SprintSlot, "startDate" | "durationDays">): string {
  return addDaysLocal(slot.startDate, slot.durationDays - 1);
}
