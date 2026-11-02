import assert from "node:assert/strict";
import { describe, it } from "node:test";
// The server's calendar is a mirror of the client's (see the header of both files); running the same cases
// over the two is what keeps the heatmap and the assistant's workload from disagreeing about a holiday.
import * as server from "../../server/src/workCalendar";
import { burndown, idleDays, workingDaysLocal } from "../src/boardModel";
import { buildResourceLoad } from "../src/resourceAllocation";
import { cellTooltip } from "../src/resourceTimeline";
import { dayClass, expectation } from "../src/timesheetDays";
import type { BoardIssue, BoardSnapshot, Sprint, TimesheetPerson } from "../src/types";
import * as client from "../src/workCalendar";
import { describeWorkDays, expandRange, formatRange, groupDated, makeUpDayWarning, mergeDated } from "../src/workCalendarForm";
import { task } from "./fixtures";

// Tết 2027: Wed 3/2 – Tue 9/2 off (the weekend between too), Saturday 30/1 is a make-up day.
const settings = {
  workDays: [1, 2, 3, 4, 5],
  holidays: ["2027-02-03", "2027-02-04", "2027-02-05", "2027-02-06", "2027-02-07", "2027-02-08", "2027-02-09"].map((date) => ({
    date,
    name: "Tết Nguyên đán",
  })),
  makeUpDays: [{ date: "2027-01-30", name: "Làm bù Tết" }],
};

for (const [side, lib] of [
  ["client", client],
  ["server", server],
] as const) {
  describe(`workCalendar (${side})`, () => {
    const tet = lib.toWorkCalendar(settings);

    it("no calendar saved = Monday–Friday", () => {
      assert.equal(lib.toWorkCalendar(null), lib.DEFAULT_WORK_CALENDAR);
      assert.equal(lib.dayKind("2027-01-30"), "weekend");
      assert.equal(lib.dayKind("2027-02-03"), "work");
    });

    it("make-up day worked, holiday off, rest by weekday", () => {
      assert.deepEqual(
        ["2027-01-29", "2027-01-30", "2027-01-31", "2027-02-03", "2027-02-06", "2027-02-10"].map((d) => lib.dayKind(d, tet)),
        ["work", "work", "weekend", "holiday", "holiday", "work"]
      );
      assert.equal(lib.dayLabel("2027-02-03", tet), "Tết Nguyên đán");
      assert.equal(lib.dayLabel("2027-01-30", tet), "Làm bù Tết");
      assert.deepEqual(lib.workingDates("2027-01-29", "2027-02-10", tet), ["2027-01-29", "2027-01-30", "2027-02-01", "2027-02-02", "2027-02-10"]);
    });

    it("a copy cached before make-up days existed still reads", () => {
      const old = lib.toWorkCalendar({ workDays: [1, 2, 3, 4, 5, 6], holidays: [] });
      assert.equal(lib.isWorkingDate("2027-01-30", old), true);
      assert.equal(lib.isWorkingDate("2027-01-31", old), false);
    });
  });
}

const tet = client.toWorkCalendar(settings);

describe("heatmap on the project's calendar", () => {
  const load = (calendar?: client.WorkCalendar) =>
    buildResourceLoad({
      tasks: [
        task({
          id: "P-1",
          summary: "x",
          assigneeAccountId: "a",
          startDate: "2027-02-01",
          dueDate: "2027-02-05",
          estimateHours: 6,
          statusCategory: "indeterminate",
        }),
      ],
      users: [{ accountId: "a", displayName: "An", avatarUrl: null }],
      profiles: [],
      absences: [],
      from: "2027-01-29",
      to: "2027-02-05",
      calendar,
    }).people[0];

  it("a holiday has no capacity and is named; the estimate spreads over the days worked", () => {
    const p = load(tet);
    const day = (d: string) => p.days.find((x) => x.date === d)!;
    assert.equal(day("2027-02-03").offReason, "holiday");
    assert.equal(day("2027-02-03").offLabel, "Tết Nguyên đán");
    assert.equal(day("2027-02-03").capacityHours, 0);
    assert.equal(day("2027-02-01").allocatedHours, 3); // 6h over Mon 1 and Tue 2 only
    assert.equal(day("2027-01-30").capacityHours, 8); // make-up Saturday
    assert.equal(day("2027-01-30").offReason, null);
  });

  it("without a calendar, the old Monday–Friday rule", () => {
    const p = load();
    assert.equal(p.days.find((x) => x.date === "2027-02-03")!.capacityHours, 8);
    assert.equal(p.days.find((x) => x.date === "2027-01-30")!.offReason, "weekend");
  });

  it("the tooltip names the holiday", () => {
    const tip = cellTooltip({
      start: "2027-02-03",
      end: "2027-02-03",
      allocated: 0,
      capacity: 0,
      ratio: 0,
      taskIds: [],
      holiday: "Tết Nguyên đán",
    });
    assert.equal(tip, "03/02/2027 · Ngày lễ: Tết Nguyên đán");
  });
});

describe("timesheet on the project's calendar", () => {
  const person = {
    capacityHoursPerDay: 8,
    absences: [{ id: "x", accountId: "a", from: "2027-02-10", to: "2027-02-10", reason: null }],
  } as unknown as TimesheetPerson;
  const days = ["2027-01-29", "2027-01-30", "2027-01-31", "2027-02-01", "2027-02-02", "2027-02-03", "2027-02-10", "2027-02-11"];

  it("a holiday is nobody's gap, a make-up Saturday expects a day, leave expects nothing", () => {
    const { expected, missing } = expectation(person, days, "2027-02-11", () => 0, tet);
    // Worked: 29, 30 (make-up), 1, 2, 11 (today) — 10 is leave, 3 is Tết, 31 is Sunday.
    assert.equal(expected, 5 * 8);
    assert.deepEqual(missing, ["2027-01-29", "2027-01-30", "2027-02-01", "2027-02-02"]);
  });

  it("columns: holiday marked as one, weekend shaded, make-up day plain", () => {
    assert.equal(dayClass("2027-02-03", tet), "is-weekend is-holiday");
    assert.equal(dayClass("2027-01-31", tet), "is-weekend");
    assert.equal(dayClass("2027-01-30", tet), "");
  });
});

describe("sprint days on the project's calendar", () => {
  it("working days, burndown points and idle days skip Tết", () => {
    assert.equal(workingDaysLocal("2027-01-25", "2027-02-12", tet).length, 5 + 1 + 2 + 3); // 25–29, Sat 30, 1–2, 10–12
    const sprint = { id: 1, startDate: "2027-01-25T02:00:00Z", endDate: "2027-02-12T10:00:00Z" } as Sprint;
    const snapshot = { estimation: null } as unknown as BoardSnapshot;
    const points = burndown(sprint, [], snapshot, "2027-02-10", tet);
    assert.equal(points.length, 11);
    assert.ok(!points.some((p) => p.date === "2027-02-03"));
    const issue = { updated: "2027-02-02T03:00:00Z" } as BoardIssue;
    assert.equal(idleDays(issue, "2027-02-11", tet), 2); // 10, 11 — nothing between 3 and 9 counts
    assert.equal(idleDays(issue, "2027-02-11"), 7);
  });
});

describe("calendar dialog helpers", () => {
  it("describes the working week", () => {
    assert.equal(describeWorkDays([1, 2, 3, 4, 5]), "T2–T6");
    assert.equal(describeWorkDays([5, 1, 3]), "T2, T4, T6");
    assert.equal(describeWorkDays([1, 2, 3, 4, 5, 6]), "T2–T7");
    assert.equal(describeWorkDays([6, 7]), "T7, CN");
  });

  it("a range goes in as one entry per date, and comes back out as one row", () => {
    const added = expandRange("2027-02-05", "2027-02-08", " Tết ");
    assert.ok(Array.isArray(added));
    assert.deepEqual(
      added.map((e) => e.date),
      ["2027-02-05", "2027-02-06", "2027-02-07", "2027-02-08"]
    );
    const list = mergeDated(
      [
        { date: "2027-02-06", name: "cũ" },
        { date: "2027-04-30", name: "30/4" },
      ],
      added
    );
    assert.deepEqual(
      groupDated(list).map((g) => [formatRange(g.from, g.to), g.name, g.dates.length]),
      [
        ["05/02–08/02/2027", "Tết", 4],
        ["30/04/2027", "30/4", 1],
      ]
    );
    assert.equal(formatRange("2026-12-31", "2027-01-01"), "31/12/2026–01/01/2027");
  });

  it("refuses a backward or runaway range", () => {
    assert.deepEqual(expandRange("2027-02-08", "2027-02-05", ""), { error: "Ngày kết thúc phải sau ngày bắt đầu." });
    assert.match((expandRange("2027-01-01", "2028-01-01", "") as { error: string }).error, /tối đa 31 ngày/);
    assert.deepEqual(expandRange("", "", ""), { error: "Chọn ngày bắt đầu." });
  });

  it("a make-up day must be a day that is otherwise off, and not a holiday", () => {
    assert.equal(makeUpDayWarning("2027-01-30", [1, 2, 3, 4, 5], []), null);
    assert.match(makeUpDayWarning("2027-01-29", [1, 2, 3, 4, 5], [])!, /vốn đã là ngày làm việc/);
    assert.match(makeUpDayWarning("2027-02-06", [1, 2, 3, 4, 5], settings.holidays)!, /đang là ngày lễ/);
  });
});
