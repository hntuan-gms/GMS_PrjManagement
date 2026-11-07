import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addDaysIso, changeSchedule, dueFor, inclusiveDays, scheduleOf } from "../src/scheduleFields";

describe("scheduleFields", () => {
  it("due = start + duration - 1", () => {
    assert.equal(dueFor("2026-10-30", 4), "2026-11-02");
    assert.equal(dueFor("2026-10-30", 1), "2026-10-30");
    assert.equal(dueFor("", 4), "");
    assert.equal(dueFor("2026-10-30", 0), "");
  });

  it("a fraction takes the next whole day", () => {
    assert.equal(dueFor("2026-10-30", 1.5), "2026-10-31");
  });

  it("counts days inclusive, across months, years and leap days", () => {
    assert.equal(inclusiveDays("2026-10-30", "2026-11-02"), 4);
    assert.equal(inclusiveDays("2026-12-30", "2027-01-02"), 4);
    assert.equal(inclusiveDays("2028-02-28", "2028-03-01"), 3);
    assert.equal(inclusiveDays("2026-11-05", "2026-11-05"), 1);
    assert.equal(inclusiveDays("2026-11-05", "2026-11-03"), -1);
    assert.equal(addDaysIso("2026-12-31", 1), "2027-01-01");
  });

  it("changing the start keeps the duration and moves the due date", () => {
    const s = scheduleOf("2026-10-30", 4);
    assert.deepEqual(changeSchedule(s, "start", "2026-11-10"), { start: "2026-11-10", durationDays: 4, due: "2026-11-13" });
  });

  it("changing the duration recomputes the due date", () => {
    const s = scheduleOf("2026-10-30", 4);
    assert.deepEqual(changeSchedule(s, "duration", 2), { start: "2026-10-30", durationDays: 2, due: "2026-10-31" });
    assert.equal(changeSchedule(s, "duration", 0).rejected, "bad-value");
  });

  it("changing the due date changes the duration", () => {
    const s = scheduleOf("2026-10-30", 4);
    assert.deepEqual(changeSchedule(s, "due", "2026-11-05"), { start: "2026-10-30", durationDays: 7, due: "2026-11-05" });
    assert.deepEqual(changeSchedule(s, "due", "2026-10-30"), { start: "2026-10-30", durationDays: 1, due: "2026-10-30" });
  });

  it("a due date before the start is refused and nothing changes", () => {
    const s = scheduleOf("2026-10-30", 4);
    const r = changeSchedule(s, "due", "2026-10-29");
    assert.equal(r.rejected, "due-before-start");
    assert.equal(r.start, s.start);
    assert.equal(r.durationDays, 4);
    assert.equal(r.due, s.due);
  });

  it("without a start, the due date places the start", () => {
    const s = scheduleOf(null, 3);
    assert.equal(s.due, "");
    assert.deepEqual(changeSchedule(s, "due", "2026-11-05"), { start: "2026-11-03", durationDays: 3, due: "2026-11-05" });
    assert.deepEqual(changeSchedule(s, "start", "2026-11-03"), { start: "2026-11-03", durationDays: 3, due: "2026-11-05" });
  });

  it("an unreadable date is refused", () => {
    const s = scheduleOf("2026-10-30", 4);
    assert.equal(changeSchedule(s, "start", "30/10/2026").rejected, "bad-value");
    assert.equal(changeSchedule(s, "due", "2026-13-40").rejected, "bad-value");
  });
});
