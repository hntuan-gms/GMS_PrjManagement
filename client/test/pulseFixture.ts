import { pulseDecisions } from "../src/projectPulse";
import { addDays, buildResourceLoad } from "../src/resourceAllocation";
import type { Booking, JiraUser, ProgressMetrics } from "../src/types";
import { toWorkCalendar } from "../src/workCalendar";
import { task } from "./fixtures";

// Monday 2026-11-16: two weeks of work for An, 40h in the first week.
const TODAY = "2026-11-16";
const users: JiraUser[] = [{ accountId: "an", displayName: "Trần An", avatarUrl: null }];
const cal = toWorkCalendar(null);

const metrics = (): ProgressMetrics =>
  ({
    asOf: TODAY,
    counts: { total: 1, done: 0, inProgress: 1, todo: 0, overdue: 0, slipped: 0, dueSoon: 0, notStarted: 0, unassigned: 0, undated: 0, noBaseline: 0, criticalOpen: 0 },
    actualPct: 0,
    plannedPct: 0,
    spi: null,
    health: "on_track",
    healthReasons: [],
    schedule: { start: TODAY, plannedEnd: "2026-11-20", baselineEnd: "2026-11-20", slipDays: 0, daysRemaining: 4 },
    overdue: [],
    slipped: [],
    dueSoon: [],
    notStarted: [],
    unassigned: [],
    phases: [],
    people: [],
  }) as unknown as ProgressMetrics;

const booking = (projectKey: string): Booking => ({
  id: "b",
  accountId: "an",
  projectKey,
  from: TODAY,
  to: addDays(TODAY, 13),
  hoursPerDay: 2,
  status: "confirmed",
  note: null,
  editable: true,
});

/** The decisions for the same plan with: a booking on this project, none, and one on another project only. */
export function projectPulseDecisionsForTest() {
  const tasks = [task({ id: "P-1", summary: "việc", startDate: TODAY, dueDate: "2026-11-20", durationDays: 5, assigneeAccountId: "an", assigneeName: "Trần An", statusCategory: "indeterminate" })];
  const soon = { from: TODAY, to: addDays(TODAY, 13) };
  const load = buildResourceLoad({ tasks, users, profiles: [], absences: [], from: soon.from, to: soon.to, calendar: cal });
  const run = (bookings: Booking[]) => pulseDecisions(metrics(), tasks, users, TODAY, cal, load, { bookings, absences: [], projectKey: "P", soon });
  return { withBooking: run([booking("P")]), withoutBooking: run([]), otherProjectOnly: run([booking("Q")]) };
}
