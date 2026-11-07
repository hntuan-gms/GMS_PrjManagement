/*
 * The three fields of a schedule (start, duration, due) and what changing one does to the others
 * (plan D2/C4). Pure, so the detail panel and the WBS cells agree. Dates are `YYYY-MM-DD`, durations
 * are calendar days and inclusive: due = start + duration - 1, as everywhere else in the app. The
 * patch sent to the server still carries only startDate + durationDays.
 */

export interface Schedule {
  /** "" when the task has no start yet. */
  start: string;
  /** Calendar days; a fraction is allowed while typing and rounds up to a whole day for the end. */
  durationDays: number;
  /** "" while start or duration is missing. */
  due: string;
}

export type ScheduleField = "start" | "duration" | "due";

export interface ScheduleResult extends Schedule {
  /** Set when the change was refused and the schedule is left as it was. */
  rejected?: "due-before-start" | "bad-value";
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

const utcMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

export function isIsoDate(v: string): boolean {
  return ISO.test(v) && Number.isFinite(utcMs(v));
}

/** `iso` plus `days` (negative allowed), in UTC so a timezone ahead of UTC cannot drift a day. */
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(utcMs(iso));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Calendar days from `start` to `due`, both counted: same day = 1. Zero or negative when due is before start. */
export function inclusiveDays(start: string, due: string): number {
  return Math.round((utcMs(due) - utcMs(start)) / DAY_MS) + 1;
}

/** The last day of work that starts on `start` and lasts `durationDays`; "" when either is unusable. */
export function dueFor(start: string, durationDays: number): string {
  if (!isIsoDate(start) || !(durationDays > 0)) return "";
  return addDaysIso(start, Math.max(1, Math.ceil(durationDays)) - 1);
}

/** A schedule from the two stored fields, with its due date worked out. */
export function scheduleOf(start: string | null | undefined, durationDays: number): Schedule {
  const s = start ?? "";
  return { start: s, durationDays, due: dueFor(s, durationDays) };
}

/**
 * Change one field and recompute the others.
 * - start: the duration stays, the due date moves with it.
 * - duration: the due date is recomputed from the start.
 * - due: the duration becomes due - start + 1. With no start yet, the start is placed so the
 *   current duration ends on that day. A due date before the start is refused.
 */
export function changeSchedule(s: Schedule, field: ScheduleField, value: string | number): ScheduleResult {
  if (field === "duration") {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n) || n <= 0) return { ...s, rejected: "bad-value" };
    return { start: s.start, durationDays: n, due: dueFor(s.start, n) };
  }
  const iso = String(value);
  if (!isIsoDate(iso)) return { ...s, rejected: "bad-value" };
  if (field === "start") {
    return { start: iso, durationDays: s.durationDays, due: dueFor(iso, s.durationDays) };
  }
  // field === "due"
  if (!isIsoDate(s.start)) {
    const days = Math.max(1, Math.ceil(s.durationDays));
    return { start: addDaysIso(iso, -(days - 1)), durationDays: s.durationDays, due: iso };
  }
  const days = inclusiveDays(s.start, iso);
  if (days < 1) return { ...s, rejected: "due-before-start" };
  return { start: s.start, durationDays: days, due: iso };
}
