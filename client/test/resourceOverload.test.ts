import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildResourceLoad, firstOverloadedDate, loadInRange, overloadedDaysIn } from "../src/resourceAllocation";
import { overloadWindow, summaryWindow } from "../src/resourceColumns";
import type { JiraUser } from "../src/types";
import { task } from "./fixtures";

const an: JiraUser = { accountId: "an", displayName: "An", avatarUrl: null };
// 2026-11-02 is a Monday. An has two tasks piled on Wed 4 and Thu 5 (16 h on an 8 h day) and one more on Mon 16.
const tasks = [
  task({ id: "A-1", summary: "a", startDate: "2026-11-04", dueDate: "2026-11-05", assigneeAccountId: "an" }),
  task({ id: "A-2", summary: "b", startDate: "2026-11-04", dueDate: "2026-11-05", assigneeAccountId: "an" }),
  task({ id: "A-3", summary: "c", startDate: "2026-11-16", dueDate: "2026-11-16", assigneeAccountId: "an" }),
  task({ id: "A-4", summary: "d", startDate: "2026-11-16", dueDate: "2026-11-16", assigneeAccountId: "an" }),
];
const load = buildResourceLoad({ tasks, users: [an], profiles: [], absences: [], from: "2026-11-02", to: "2026-11-30", includeIdle: true });
const days = load.people[0].days;

describe("overloadedDaysIn", () => {
  it("counts only the days inside the window", () => {
    assert.equal(load.people[0].overloadedDays, 3);
    assert.equal(overloadedDaysIn(days, "2026-11-02", "2026-11-15"), 2);
    assert.equal(overloadedDaysIn(days, "2026-11-06", "2026-11-15"), 0);
    assert.equal(overloadedDaysIn(days, "2026-11-16", "2026-11-16"), 1);
  });

  it("finds the first over-capacity day from a date on, or none", () => {
    assert.equal(firstOverloadedDate(days, "2026-11-02"), "2026-11-04");
    assert.equal(firstOverloadedDate(days, "2026-11-05"), "2026-11-05");
    assert.equal(firstOverloadedDate(days, "2026-11-06"), "2026-11-16");
    assert.equal(firstOverloadedDate(days, "2026-11-17"), null);
  });

  it("the badge window is today and the thirteen days after", () => {
    assert.deepEqual(overloadWindow("2026-11-02"), { from: "2026-11-02", to: "2026-11-15" });
  });
});

describe("loadInRange + summaryWindow", () => {
  it("sums hours given and available inside the window only", () => {
    // Mon 2 .. Fri 6: 5 working days = 40 h available, 32 h given on Wed and Thu.
    const r = loadInRange(days, "2026-11-02", "2026-11-08");
    assert.equal(r.capacityHours, 40);
    assert.equal(r.allocatedHours, 32);
    assert.equal(r.utilisation, 0.8);
  });

  it("nothing available is 0 utilisation, not NaN", () => {
    const r = loadInRange(days, "2026-11-07", "2026-11-08"); // a weekend
    assert.equal(r.capacityHours, 0);
    assert.equal(r.utilisation, 0);
  });

  it("with no chosen window the summary is the next four weeks; with one it is that window", () => {
    assert.deepEqual(summaryWindow(null, "2026-11-02"), { from: "2026-11-02", to: "2026-11-29", label: "4 tuần tới" });
    const w = summaryWindow({ from: "2026-11-02", to: "2026-11-08" }, "2026-11-02");
    assert.equal(w.label, "02/11 – 08/11/2026");
  });
});
