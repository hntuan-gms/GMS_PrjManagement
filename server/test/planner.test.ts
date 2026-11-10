import assert from "node:assert/strict";
import { test } from "node:test";
import { isIsoDate, layoutSchedule } from "../src/ai/planner.js";

type Dep = { tempId: string; type: "FS" | "SS" | "FF" | "SF"; lagDays: number };
const item = (tempId: string, durationDays: number, notBefore: string | null = null, dependencies: Dep[] = []) => ({
  tempId,
  parentTempId: null,
  summary: tempId,
  description: null,
  issueType: "Task",
  durationDays,
  assigneeAccountId: null,
  dependencies,
  rationale: null,
  notBefore,
});

test("independent items without a fixed day all start on day 1", () => {
  const laid = layoutSchedule([item("a", 3), item("b", 5)], "2026-11-10");
  assert.deepEqual(
    laid.map((i) => [i.startDate, i.dueDate]),
    [
      ["2026-11-10", "2026-11-12"],
      ["2026-11-10", "2026-11-14"],
    ]
  );
});

// MEIKOS26, 2026-11-10: five monthly maintenance windows were all drawn on day 1
// while the assistant described them month by month.
test("a fixed earliest day spreads monthly windows out as asked", () => {
  const laid = layoutSchedule(
    [item("T12", 12, "2026-12-20"), item("T01", 12, "2027-01-20"), item("T02", 9, "2027-02-20")],
    "2026-11-10"
  );
  assert.deepEqual(
    laid.map((i) => [i.startDate, i.dueDate]),
    [
      ["2026-12-20", "2026-12-31"],
      ["2027-01-20", "2027-01-31"],
      ["2027-02-20", "2027-02-28"],
    ]
  );
});

test("a fixed day is a floor, not a pin: a later predecessor still pushes the item", () => {
  const laid = layoutSchedule(
    [item("a", 10), item("b", 2, "2026-11-12", [{ tempId: "a", type: "FS", lagDays: 0 }])],
    "2026-11-10"
  );
  assert.equal(laid[1].startDate, "2026-11-20");
});

test("a fixed day before the plan's start changes nothing", () => {
  const laid = layoutSchedule([item("a", 1, "2026-01-01")], "2026-11-10");
  assert.equal(laid[0].startDate, "2026-11-10");
});

test("rows stored before the column existed lay out as before", () => {
  const { notBefore: _drop, ...old } = item("a", 2);
  assert.equal(layoutSchedule([old], "2026-11-10")[0].startDate, "2026-11-10");
});

test("only real calendar dates pass", () => {
  assert.equal(isIsoDate("2027-02-28"), true);
  assert.equal(isIsoDate("2027-02-30"), false);
  assert.equal(isIsoDate("20/12/2026"), false);
  assert.equal(isIsoDate(""), false);
});
