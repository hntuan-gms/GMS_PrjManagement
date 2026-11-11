import type { HeldHours } from "./bookingModel";
import { fmtBookingHours } from "./bookingModel";
import { shortRange } from "./dateLabels";
import { DEFAULT_CAPACITY_HOURS, taskSpan, type PersonLoad, type ResourceLoad } from "./resourceAllocation";
import { DEFAULT_WORK_CALENDAR, dayKind, type WorkCalendar } from "./workCalendar";
import type { JiraUser, Task } from "./types";

/*
 * "Who could take this?", answered inside the task's own dates (plan 0-3). The numbers come from the
 * load the heatmap already holds (`buildResourceLoad`), so a hint and a heatmap cell cannot disagree.
 *
 * The ORDER is the same rule as the assistant's auto-assignment, server/src/workload.ts `rankCandidates`:
 * fewest conflict days first, then the most free hours. The server also breaks ties on overflow, share
 * of capacity and open-task count; here a tie falls to free hours and then the name. Change both.
 *
 * Hours the person has promised to OTHER projects (`held`, bookingModel.heldElsewhereByDay) count like tasks on
 * the day, exactly as the server's `heldElsewhere` does (server/src/workload.ts, bookingLoad.ts).
 */

export interface AssignHint {
  accountId: string;
  /** False when the task has no dates: nothing to measure, show only the name. */
  ranged: boolean;
  /** Working days in the task's span where taking the task would go past the person's capacity. */
  conflictDays: number;
  /** Of `conflictDays`, those that exist only because of hours other projects hold. */
  heldConflictDays: number;
  /** The most hours a day other projects hold of this person inside the span (0 when none). */
  heldPerDay: number;
  /** Spare hours across the task's working days before taking it. */
  freeHours: number;
  /** The person's first leave overlapping the span (whole leave, not clipped), else null. */
  away: { from: string; to: string } | null;
  /** Days of the span that fall in leave, and working days left over (0 = away the whole time). */
  awayDays: number;
  availableDays: number;
}

export interface HintText {
  text: string;
  tone?: "risk" | "ok";
}

/**
 * What a picker row says beside the name: "nghỉ 12–14/11" (away for the whole span), "trùng 3 ngày"
 * (risk), "nghỉ 12–14/11" again for leave that only covers part of it, else "rảnh". Nothing for a task
 * without dates: the row is just the name.
 */
export function describeHint(h: AssignHint | undefined): HintText | null {
  if (!h || !h.ranged) return null;
  const leave = h.away ? `nghỉ ${shortRange(h.away.from, h.away.to)}` : null;
  if (h.availableDays === 0 && leave) return { text: leave, tone: "risk" };
  if (h.conflictDays > 0) {
    const held = h.heldConflictDays > 0 ? `bị giữ ${fmtBookingHours(h.heldPerDay)}/ngày` : null;
    // Only the bookings cause it: say so alone. Both: the days, then where the other part comes from.
    if (held && h.heldConflictDays === h.conflictDays) return { text: held, tone: "risk" };
    return { text: held ? `trùng ${h.conflictDays} ngày · ${held}` : `trùng ${h.conflictDays} ngày`, tone: "risk" };
  }
  if (leave) return { text: leave };
  return { text: "rảnh", tone: "ok" };
}

/** Hours the task itself asks of one day: its estimate spread over the span's working days, else a full day. */
function demandPerDay(task: Task, workingDays: number, capacity: number): number {
  return task.estimateHours != null && task.estimateHours > 0 && workingDays > 0 ? task.estimateHours / workingDays : capacity;
}

function hintFor(
  task: Task,
  span: string[],
  user: JiraUser,
  person: PersonLoad | undefined,
  calendar: WorkCalendar,
  held: ReadonlyMap<string, number> | undefined
): AssignHint {
  const capacity = person?.capacityHoursPerDay ?? DEFAULT_CAPACITY_HOURS;
  const absences = person?.absences ?? [];
  const leaveOn = (d: string) => absences.some((a) => d >= a.from && d <= a.to);
  const offDay = (d: string) => dayKind(d, calendar) !== "work" || leaveOn(d);

  const working = span.filter((d) => !offDay(d));
  const perDay = demandPerDay(task, working.length, capacity);
  const dayByDate = new Map((person?.days ?? []).map((d) => [d.date, d]));
  const mine = person !== undefined && task.assigneeAccountId === person.accountId;

  let conflictDays = 0;
  let heldConflictDays = 0;
  let heldPerDay = 0;
  let freeHours = 0;
  for (const date of working) {
    const day = dayByDate.get(date);
    // A date outside the load's window is unknown, so it counts as empty rather than as a conflict.
    let tasksHere = day?.allocatedHours ?? 0;
    // The task already sits in its current owner's load; asking "could they take it" must not count it twice.
    if (mine && day?.taskIds.includes(task.id)) tasksHere = Math.max(0, tasksHere - perDay);
    const heldHere = held?.get(date) ?? 0;
    heldPerDay = Math.max(heldPerDay, heldHere);
    const already = tasksHere + heldHere;
    freeHours += Math.max(0, capacity - already);
    if (already + perDay > capacity + 0.0001) {
      conflictDays += 1;
      if (tasksHere + perDay <= capacity + 0.0001) heldConflictDays += 1;
    }
  }

  const leave = absences.filter((a) => a.from <= span[span.length - 1] && a.to >= span[0]).sort((a, b) => a.from.localeCompare(b.from));
  return {
    accountId: user.accountId,
    ranged: true,
    conflictDays,
    heldConflictDays,
    heldPerDay: Math.round(heldPerDay * 10) / 10,
    freeHours: Math.round(freeHours * 10) / 10,
    away: leave.length ? { from: leave[0].from, to: leave[0].to } : null,
    awayDays: span.filter(leaveOn).length,
    availableDays: working.length,
  };
}

/**
 * One hint per person, best candidate first. `load` is the heatmap's own output; people it does not
 * list (nobody asked for idle people) are treated as having nothing booked. Without dates on the task
 * every hint is `ranged: false` and people stay in alphabetical order.
 */
export function assignHints(
  task: Task,
  people: readonly JiraUser[],
  load: Pick<ResourceLoad, "people"> | null,
  calendar: WorkCalendar = DEFAULT_WORK_CALENDAR,
  held?: HeldHours
): AssignHint[] {
  const byAccount = new Map((load?.people ?? []).map((p) => [p.accountId, p]));
  const name = (u: JiraUser) => u.displayName;
  const span = taskSpan(task);

  if (span.length === 0) {
    return [...people]
      .sort((a, b) => name(a).localeCompare(name(b), "vi"))
      .map((u) => ({ accountId: u.accountId, ranged: false, conflictDays: 0, heldConflictDays: 0, heldPerDay: 0, freeHours: 0, away: null, awayDays: 0, availableDays: 0 }));
  }

  const rows = people.map((u) => ({ u, hint: hintFor(task, span, u, byAccount.get(u.accountId), calendar, held?.get(u.accountId)) }));
  rows.sort(
    (a, b) =>
      a.hint.conflictDays - b.hint.conflictDays ||
      b.hint.freeHours - a.hint.freeHours ||
      name(a.u).localeCompare(name(b.u), "vi")
  );
  return rows.map((r) => r.hint);
}
