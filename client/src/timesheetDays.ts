import type { TimesheetPerson } from "./types";
import { dayKind, type WorkCalendar } from "./workCalendar";

/*
 * Which days a timesheet expects hours on — kept out of TimesheetView so the rule is tested without a browser.
 * The project's calendar decides what a working day is (workCalendar.ts): a holiday is nobody's gap and expects
 * nothing, a make-up Saturday expects a day's work. Then the person's own leave.
 */

export function isAway(p: Pick<TimesheetPerson, "absences">, d: string): boolean {
  return p.absences.some((a) => a.from <= d && d <= a.to);
}

/**
 * Hours expected so far and the working days already past with nothing logged. "Expected" counts only days
 * already reached — a Wednesday view of this week does not call Thursday and Friday missing — and today is
 * expected but not yet missing.
 */
export function expectation(
  p: Pick<TimesheetPerson, "absences" | "capacityHoursPerDay">,
  days: string[],
  today: string,
  hoursOn: (d: string) => number,
  calendar: WorkCalendar
): { expected: number; missing: string[] } {
  let expected = 0;
  const missing: string[] = [];
  for (const d of days) {
    if (d > today || dayKind(d, calendar) !== "work" || isAway(p, d)) continue;
    expected += p.capacityHoursPerDay;
    if (d < today && hoursOn(d) === 0) missing.push(d);
  }
  return { expected, missing };
}

/** CSS class of a timesheet column: a weekend and a holiday are both shaded, a holiday also marked as one. */
export function dayClass(d: string, calendar: WorkCalendar): string {
  const kind = dayKind(d, calendar);
  return kind === "holiday" ? "is-weekend is-holiday" : kind === "weekend" ? "is-weekend" : "";
}
