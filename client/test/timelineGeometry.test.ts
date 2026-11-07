import assert from "node:assert/strict";
import { test } from "node:test";
import { anchorDay, dateAtX, dateEdgeX, dragSpan, shiftDay, type DateRef } from "../src/timelineGeometry";

// A Day-view chart: 60px a day, the bar for 10–12 Nov starting at x=120 (so 08 Nov is x=0).
const bar: DateRef = { rect: { x: 120, y: 0, width: 180, height: 20 }, range: { start: "2026-11-10", end: "2026-11-12" } };

test("shiftDay is calendar arithmetic across months and years", () => {
  assert.equal(shiftDay("2026-11-30", 1), "2026-12-01");
  assert.equal(shiftDay("2026-01-01", -1), "2025-12-31");
  assert.equal(shiftDay("2026-03-01", -1), "2026-02-28");
});

test("dateAtX reads the day whose column holds x; a bar's left edge is its start", () => {
  assert.equal(dateAtX([bar], 120, 60), "2026-11-10");
  assert.equal(dateAtX([bar], 179, 60), "2026-11-10");
  assert.equal(dateAtX([bar], 180, 60), "2026-11-11");
  assert.equal(dateAtX([bar], 59, 60), "2026-11-08");
  assert.equal(dateAtX([bar], 400, 60), "2026-11-14");
  assert.equal(dateAtX([], 10, 60), null);
});

test("dateAtX and dateEdgeX are inverses on a day edge", () => {
  for (const d of ["2026-11-05", "2026-11-10", "2026-11-19"]) {
    const x = dateEdgeX([bar], d, 60)!;
    assert.equal(dateAtX([bar], x + 1, 60), d);
  }
});

test("a bar drawn at the library's 16px minimum is not a ruler: the zoom's own scale is used", () => {
  const tiny: DateRef = { rect: { x: 100, y: 0, width: 16, height: 20 }, range: { start: "2026-11-10", end: "2026-11-10" } };
  assert.equal(dateAtX([tiny], 100 + 30, 3.3), "2026-11-19");
  assert.equal(dateEdgeX([tiny], "2026-11-20", 3.3)!.toFixed(1), (100 + 10 * 3.3).toFixed(1));
});

test("the nearest bar is the ruler (Month view: columns are uneven)", () => {
  const near: DateRef = { rect: { x: 1000, y: 0, width: 90, height: 20 }, range: { start: "2027-02-01", end: "2027-02-03" } }; // 30px/day
  assert.equal(dateAtX([bar, near], 1030, 60), "2027-02-02");
  assert.equal(dateAtX([bar, near], 190, 60), "2026-11-11");
});

test("dragging either way schedules the same span; a click is one day", () => {
  assert.deepEqual(dragSpan("2026-11-12", "2026-11-14"), { start: "2026-11-12", durationDays: 3 });
  assert.deepEqual(dragSpan("2026-11-14", "2026-11-12"), { start: "2026-11-12", durationDays: 3 });
  assert.deepEqual(dragSpan("2026-11-12", "2026-11-12"), { start: "2026-11-12", durationDays: 1 });
});

test("the invisible bar's day never widens the axis", () => {
  assert.equal(anchorDay("2026-11-07", "2026-10-01", "2026-12-31"), "2026-11-07");
  assert.equal(anchorDay("2026-09-01", "2026-10-01", "2026-12-31"), "2026-10-01");
  assert.equal(anchorDay("2027-03-01", "2026-10-01", "2026-12-31"), "2026-12-31");
  assert.equal(anchorDay("2026-11-07", null, null), "2026-11-07");
});

import { weekAxisStart } from "../src/timelineGeometry";

test("the Week axis starts on the Monday a week before the earliest bar", () => {
  // 10 Nov 2026 is a Tuesday: its Monday is 9 Nov, one week back is 2 Nov.
  assert.equal(weekAxisStart("2026-11-10"), "2026-11-02");
  assert.equal(weekAxisStart("2026-11-09"), "2026-11-02");
  assert.equal(weekAxisStart("2026-11-15"), "2026-11-02");
  assert.equal(weekAxisStart("2026-11-16"), "2026-11-09");
});
