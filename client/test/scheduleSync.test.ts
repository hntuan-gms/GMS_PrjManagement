import assert from "node:assert/strict";
import { test } from "node:test";
import { patchBetween, pendingOps, sameSched, schedOf, type Sched } from "../src/scheduleSync";
import type { Task } from "../src/types";

const s = (startDate: string | null, durationDays = 3, percentComplete = 0): Sched => ({ startDate, durationDays, percentComplete });
const task = (id: string, preds: string[] = []) => ({ id, predecessors: preds.map((taskId) => ({ taskId, type: "FS", lagDays: 0 })) }) as unknown as Task;

test("nothing to write when the screen and Jira agree", () => {
  assert.equal(patchBetween(s("2026-11-01"), s("2026-11-01")), null);
  assert.equal(sameSched(s("2026-11-01"), s("2026-11-01")), true);
});

test("a moved bar sends start and duration together; the percentage goes on its own", () => {
  assert.deepEqual(patchBetween(s("2026-11-01"), s("2026-11-05")), { startDate: "2026-11-05", durationDays: 3 });
  assert.deepEqual(patchBetween(s("2026-11-01", 3), s("2026-11-01", 5)), { startDate: "2026-11-01", durationDays: 5 });
  assert.deepEqual(patchBetween(s("2026-11-01", 3, 0), s("2026-11-01", 3, 40)), { percentComplete: 40 });
  assert.deepEqual(patchBetween(s("2026-11-01", 3, 0), s("2026-11-02", 3, 40)), { startDate: "2026-11-02", durationDays: 3, percentComplete: 40 });
});

test("putting a task back to no start date is a write too", () => {
  assert.deepEqual(patchBetween(s("2026-11-01"), s(null)), { startDate: null, durationDays: 3 });
});

test("a drag that was undone before it was saved is no write at all", () => {
  const confirmed = new Map([["A", s("2026-11-01")]]);
  const wanted = new Map([["A", s("2026-11-01")]]);
  assert.deepEqual(pendingOps(confirmed, wanted, [task("A")]), []);
});

test("five drags are one write: only the last wanted value counts", () => {
  const confirmed = new Map([["A", s("2026-12-05")]]);
  const wanted = new Map<string, Sched>();
  for (const d of ["2026-11-17", "2026-11-28", "2026-12-17", "2026-11-09", "2026-10-29"]) wanted.set("A", s(d));
  assert.deepEqual(pendingOps(confirmed, wanted, [task("A")]), [{ id: "A", patch: { startDate: "2026-10-29", durationDays: 3 } }]);
});

test("a task with no confirmed value is not written (nothing says what Jira holds)", () => {
  assert.deepEqual(pendingOps(new Map(), new Map([["A", s("2026-11-01")]]), [task("A")]), []);
});

test("a predecessor is written before what follows it, whatever order they were changed in", () => {
  const tasks = [task("A"), task("B", ["A"]), task("C", ["B"])];
  const confirmed = new Map([["A", s("2026-11-01")], ["B", s("2026-11-04")], ["C", s("2026-11-07")]]);
  const wanted = new Map([["C", s("2026-11-10")], ["B", s("2026-11-07")], ["A", s("2026-11-04")]]);
  assert.deepEqual(pendingOps(confirmed, wanted, tasks).map((o) => o.id), ["A", "B", "C"]);
});

test("order holds across a gap: A before C even when B did not change", () => {
  const tasks = [task("A"), task("B", ["A"]), task("C", ["B"])];
  const confirmed = new Map([["A", s("2026-11-01")], ["C", s("2026-11-07")]]);
  const wanted = new Map([["C", s("2026-11-10")], ["A", s("2026-11-04")]]);
  assert.deepEqual(pendingOps(confirmed, wanted, tasks).map((o) => o.id), ["A", "C"]);
});

test("unrelated tasks keep the order they were changed in; a cycle does not hang", () => {
  const tasks = [task("X"), task("Y"), task("P", ["Q"]), task("Q", ["P"])];
  const confirmed = new Map([["X", s("2026-11-01")], ["Y", s("2026-11-01")], ["P", s("2026-11-01")], ["Q", s("2026-11-01")]]);
  const wanted = new Map([["Y", s("2026-11-02")], ["X", s("2026-11-02")], ["P", s("2026-11-02")], ["Q", s("2026-11-02")]]);
  const out = pendingOps(confirmed, wanted, tasks).map((o) => o.id);
  assert.deepEqual(out.slice(0, 2), ["Y", "X"]);
  assert.equal(out.length, 4);
});

test("schedOf reads the three fields", () => {
  assert.deepEqual(schedOf({ startDate: "2026-11-01", durationDays: 2, percentComplete: 10 } as Task), s("2026-11-01", 2, 10));
});
