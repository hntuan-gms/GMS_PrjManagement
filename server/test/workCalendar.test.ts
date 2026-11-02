import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { availability, plannedWindow, workingDays } from "../src/agile/sprintMetrics.js";
import type { BoardSnapshot, Sprint } from "../src/agile/boardTypes.js";
import { buildWorkload } from "../src/workload.js";
import type { Task } from "../src/types.js";
import { DEFAULT_WORK_CALENDAR, dayKind, dayLabel, isoWeekday, isWorkingDate, toWorkCalendar, workingDates } from "../src/workCalendar.js";

// Tết 2027: Wed 3/2 – Tue 9/2 off; Saturday 6/2 is NOT worked (holiday), Saturday 30/1 is a make-up day.
const tet = toWorkCalendar({
  workDays: [1, 2, 3, 4, 5],
  holidays: ["2027-02-03", "2027-02-04", "2027-02-05", "2027-02-08", "2027-02-09"].map((date) => ({ date, name: "Tết Nguyên đán" })),
  makeUpDays: [{ date: "2027-01-30", name: "Làm bù Tết" }],
});

describe("workCalendar", () => {
  it("reads weekdays the ISO way, Monday = 1 … Sunday = 7", () => {
    assert.equal(isoWeekday("2027-02-01"), 1);
    assert.equal(isoWeekday("2027-02-07"), 7);
  });

  it("with no calendar saved, Monday–Friday and nothing else", () => {
    assert.equal(toWorkCalendar(null), DEFAULT_WORK_CALENDAR);
    assert.deepEqual(workingDates("2027-02-01", "2027-02-07"), ["2027-02-01", "2027-02-02", "2027-02-03", "2027-02-04", "2027-02-05"]);
  });

  it("a holiday is off, a make-up day is worked, the rest follows the weekday", () => {
    assert.equal(dayKind("2027-02-03", tet), "holiday");
    assert.equal(dayLabel("2027-02-03", tet), "Tết Nguyên đán");
    assert.equal(dayKind("2027-01-30", tet), "work");
    assert.equal(dayLabel("2027-01-30", tet), "Làm bù Tết");
    assert.equal(dayKind("2027-01-31", tet), "weekend");
    assert.equal(isWorkingDate("2027-02-02", tet), true);
    assert.deepEqual(workingDates("2027-01-29", "2027-02-10", tet), ["2027-01-29", "2027-01-30", "2027-02-01", "2027-02-02", "2027-02-10"]);
  });

  it("a six-day week counts Saturdays", () => {
    const six = toWorkCalendar({ workDays: [1, 2, 3, 4, 5, 6], holidays: [] });
    assert.equal(isWorkingDate("2027-02-06", six), true);
    assert.equal(isWorkingDate("2027-02-07", six), false);
  });
});

describe("workload on the project's calendar", () => {
  const task = (id: string, start: string, due: string, estimateHours: number | null): Task =>
    ({ id, summary: id, issueType: "Task", statusCategory: "indeterminate", assigneeAccountId: "a", startDate: start, dueDate: due, estimateHours }) as unknown as Task;
  const input = {
    users: [{ accountId: "a", displayName: "An" }] as any,
    profiles: [],
    absences: [],
  };

  it("spreads hours over the days actually worked, skipping the holiday", () => {
    const w = buildWorkload({ ...input, tasks: [task("P-1", "2027-02-01", "2027-02-05", 6)], calendar: tet });
    const a = w.get("a")!;
    // Mon 1, Tue 2 worked; Wed–Fri are Tết → 3h a day on two days.
    assert.deepEqual([...a.allocated], [["2027-02-01", 3], ["2027-02-02", 3]]);
    assert.equal(a.isOff("2027-02-04"), true);
    assert.equal(a.isOff("2027-01-30"), false);
  });

  it("without a calendar keeps the old Monday–Friday spread", () => {
    const w = buildWorkload({ ...input, tasks: [task("P-1", "2027-02-01", "2027-02-05", 5)] });
    assert.equal(w.get("a")!.allocated.size, 5);
  });
});

describe("sprint numbers on the project's calendar", () => {
  it("counts working days and capacity without holidays, with make-up days", () => {
    assert.equal(workingDays("2027-01-25", "2027-02-07", tet).length, 8); // 25–29 (5) + Sat 30 + 1, 2
    const [m] = availability([{ accountId: "a", displayName: "An" }], [], [], "2027-01-25", "2027-02-07", 8, tet);
    assert.equal(m.days, 8);
    assert.equal(m.capacityHours, 64);
  });

  it("a sprint planned after the active one starts on the first working day, past Tết", () => {
    const active = { id: 1, state: "active", startDate: "2027-01-20T02:00:00Z", endDate: "2027-02-02T10:00:00Z" } as Sprint;
    const target = { id: 2, state: "future", startDate: null, endDate: null } as unknown as Sprint;
    const snapshot = { sprints: [active, target], velocity: [] } as unknown as BoardSnapshot;
    assert.equal(plannedWindow(snapshot, target, "2027-01-28", 420, tet).start, "2027-02-10");
    assert.equal(plannedWindow(snapshot, target, "2027-01-28", 420).start, "2027-02-03");
  });
});
