import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  columnSpans,
  currentPreset,
  filterUnassigned,
  filterPeople,
  peopleCounts,
  placeBar,
  rangeForPreset,
  taskBarDates,
} from "../src/resourceColumns";
import { aggregateMonths, aggregateWeeks, eachDate, monthWindow, type DayLoad, type PersonLoad } from "../src/resourceAllocation";
import type { Task } from "../src/types";

const dates = eachDate("2026-10-28", "2026-12-06"); // Wed → Sun, spans three months

const day = (date: string): DayLoad => ({
  date,
  capacityHours: 8,
  allocatedHours: 0,
  ratio: 0,
  band: "free",
  taskIds: [],
  offReason: null,
});

describe("resource tab columns", () => {
  it("breaks day, week and month columns where the heatmap cells break", () => {
    const days = dates.map(day);
    const weeks = columnSpans(dates, "week");
    assert.deepEqual(
      weeks.map((w) => [w.start, w.end]),
      aggregateWeeks(days).map((w) => [w.start, w.end])
    );
    const months = columnSpans(dates, "month");
    assert.deepEqual(
      months.map((m) => [m.start, m.end]),
      aggregateMonths(days).map((m) => [m.start, m.end])
    );
    assert.equal(columnSpans(dates, "day").length, dates.length);
  });

  it("places a bar on whole columns by day", () => {
    const spans = columnSpans(dates, "day");
    const bar = placeBar(spans, "2026-10-30", "2026-11-02");
    assert.deepEqual(bar, { left: 2, width: 4, clippedLeft: false, clippedRight: false });
  });

  it("places a bar to the day inside a week column", () => {
    const spans = columnSpans(dates, "week");
    // The first column is the partial week Wed 28 → Sun 1 Nov (5 days); Mon 2 Nov starts column 1.
    const bar = placeBar(spans, "2026-11-04", "2026-11-05"); // Wed–Thu of the second week
    assert.ok(bar);
    assert.equal(bar.left, 1 + 2 / 7);
    assert.ok(Math.abs(bar.width - 2 / 7) < 1e-9, String(bar.width));
  });

  it("clips to the window and says so", () => {
    const spans = columnSpans(dates, "day");
    const bar = placeBar(spans, "2026-10-01", "2026-10-30");
    assert.deepEqual(bar, { left: 0, width: 3, clippedLeft: true, clippedRight: false });
    assert.equal(placeBar(spans, "2026-09-01", "2026-09-30"), null);
    assert.equal(placeBar(spans, "2027-01-01", "2027-01-05"), null);
    assert.equal(placeBar([], "2026-11-01", "2026-11-02"), null);
  });

  it("draws a task without a usable due date as one day", () => {
    assert.deepEqual(taskBarDates({ startDate: "2026-11-03", dueDate: null }), { start: "2026-11-03", end: "2026-11-03" });
    assert.deepEqual(taskBarDates({ startDate: "2026-11-03", dueDate: "2026-11-01" }), { start: "2026-11-03", end: "2026-11-03" });
    assert.equal(taskBarDates({ startDate: null, dueDate: "2026-11-01" }), null);
  });
});

describe("resource tab date presets", () => {
  const today = "2026-10-28";
  const tasks = [{ id: "T-1", statusCategory: "indeterminate", startDate: "2026-10-20", dueDate: "2026-12-20" }] as unknown as Task[];

  it("fixed-length presets keep the current start", () => {
    const span = { from: "2026-11-02", to: "2026-11-29" };
    assert.deepEqual(rangeForPreset("8w", span, today, tasks), { from: "2026-11-02", to: "2026-12-27" });
    assert.deepEqual(rangeForPreset("quarter", span, today, tasks), { from: "2026-11-02", to: "2027-01-30" });
  });

  it("'Theo dự án' hands the window back to the project; 'Tháng này' is the calendar month", () => {
    const span = { from: "2026-11-02", to: "2026-11-29" };
    assert.equal(rangeForPreset("project", span, today, tasks), null);
    assert.deepEqual(rangeForPreset("month", span, today, tasks), monthWindow(today));
  });

  it("reads the label back from the window", () => {
    assert.equal(currentPreset(null, today, tasks), "project");
    assert.equal(currentPreset(monthWindow(today), today, tasks), "month");
    assert.equal(currentPreset({ from: "2026-11-02", to: "2026-11-29" }, today, tasks), "4w");
    assert.equal(currentPreset({ from: "2026-11-02", to: "2026-12-27" }, today, tasks), "8w");
    assert.equal(currentPreset({ from: "2026-11-02", to: "2026-11-20" }, today, tasks), null);
  });

  it("a window shifted by the arrows is still the preset it was", () => {
    const shifted = { from: "2026-11-30", to: "2026-12-27" };
    assert.equal(currentPreset(shifted, today, tasks), "4w");
  });
});

describe("resource tab people filter", () => {
  const person = (id: string, tasks: number, overloadedDays: number) =>
    ({ accountId: id, tasks: new Array(tasks).fill({}), overloadedDays }) as unknown as PersonLoad;
  const people = [person("a", 0, 0), person("b", 2, 0), person("c", 3, 4), person("d", 1, 1)];

  it("counts everyone, people holding work, and people over capacity", () => {
    assert.deepEqual(peopleCounts(people), { all: 4, busy: 3, over: 2 });
  });

  it("narrows to the chosen pill", () => {
    assert.deepEqual(filterPeople(people, "all").map((p) => p.accountId), ["a", "b", "c", "d"]);
    assert.deepEqual(filterPeople(people, "busy").map((p) => p.accountId), ["b", "c", "d"]);
    assert.deepEqual(filterPeople(people, "over").map((p) => p.accountId), ["c", "d"]);
  });
});

describe("resource tab unassigned search", () => {
  const tasks = [
    { id: "GPM-96", summary: "Đăng nhập bằng SSO" },
    { id: "GPM-97", summary: "Báo cáo tuần" },
    { id: "GPM-100", summary: "Thiết kế bảng điều khiển" },
  ] as unknown as Task[];

  it("matches key or title without caring about case or diacritics", () => {
    assert.deepEqual(filterUnassigned(tasks, "dang nhap").map((t) => t.id), ["GPM-96"]);
    assert.deepEqual(filterUnassigned(tasks, "gpm-1").map((t) => t.id), ["GPM-100"]);
    assert.deepEqual(filterUnassigned(tasks, "  ").map((t) => t.id), ["GPM-96", "GPM-97", "GPM-100"]);
    assert.deepEqual(filterUnassigned(tasks, "zzz"), []);
  });
});
