/**
 * Which days a project works: the weekdays in its calendar, minus its holidays, plus its make-up days.
 * The calendar is the one edited in "Lịch làm việc & ngày lễ…" and stored with the SLA policy (sla.ts,
 * WorkCalendarSettings); a project that never saved one gets Monday–Friday with no holidays, which is
 * exactly what every computation here assumed before the calendar existed.
 *
 * Pure, and mirrored in client/src/workCalendar.ts — the heatmap and timesheet decide on the client what
 * the assistant's workload and sprint capacity decide here, so the rule must be the same. Change both.
 *
 * Dates are "YYYY-MM-DD" and their weekday is read in UTC, like every other date helper on the server.
 */
export interface WorkCalendarInput {
  workDays: number[];
  holidays: Array<{ date: string; name: string }>;
  makeUpDays?: Array<{ date: string; name: string }>;
}

export interface WorkCalendar {
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  workDays: ReadonlySet<number>;
  /** date → holiday name. */
  holidays: ReadonlyMap<string, string>;
  /** date → note, for days worked although their weekday is off. */
  makeUpDays: ReadonlyMap<string, string>;
}

export type DayKind = "work" | "weekend" | "holiday";

export const DEFAULT_WORK_CALENDAR: WorkCalendar = Object.freeze({
  workDays: new Set([1, 2, 3, 4, 5]),
  holidays: new Map<string, string>(),
  makeUpDays: new Map<string, string>(),
});

export function toWorkCalendar(input: WorkCalendarInput | null | undefined): WorkCalendar {
  if (!input) return DEFAULT_WORK_CALENDAR;
  const workDays = input.workDays?.length ? input.workDays : [1, 2, 3, 4, 5];
  return {
    workDays: new Set(workDays),
    holidays: new Map((input.holidays ?? []).map((h) => [h.date, h.name])),
    makeUpDays: new Map((input.makeUpDays ?? []).map((m) => [m.date, m.name])),
  };
}

/** ISO weekday of a "YYYY-MM-DD" date, 1 = Monday … 7 = Sunday. */
export function isoWeekday(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

/** A make-up day is always worked, a holiday never; everything else follows the weekday. */
export function dayKind(iso: string, cal: WorkCalendar = DEFAULT_WORK_CALENDAR): DayKind {
  if (cal.makeUpDays.has(iso)) return "work";
  if (cal.holidays.has(iso)) return "holiday";
  return cal.workDays.has(isoWeekday(iso)) ? "work" : "weekend";
}

export function isWorkingDate(iso: string, cal: WorkCalendar = DEFAULT_WORK_CALENDAR): boolean {
  return dayKind(iso, cal) === "work";
}

/** The holiday's name, or the make-up day's note, for a tooltip; "" for an ordinary day. */
export function dayLabel(iso: string, cal: WorkCalendar = DEFAULT_WORK_CALENDAR): string {
  return cal.makeUpDays.get(iso) ?? cal.holidays.get(iso) ?? "";
}

/** Every working date from `from` to `to`, both included. */
export function workingDates(from: string, to: string, cal: WorkCalendar = DEFAULT_WORK_CALENDAR): string[] {
  const out: string[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 86_400_000) {
    const iso = new Date(t).toISOString().slice(0, 10);
    if (isWorkingDate(iso, cal)) out.push(iso);
  }
  return out;
}
