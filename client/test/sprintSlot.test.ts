import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { slotEnd, sprintSlot } from "../src/sprintSlot";

type S = { state: "future" | "active" | "closed"; startDate: string | null; endDate: string | null };
const sprint = (o: Partial<S> = {}): S => ({
  state: "future",
  startDate: "2026-11-02T08:00:00",
  endDate: "2026-11-16T17:00:00",
  ...o,
});

describe("sprintSlot", () => {
  it("a future sprint: starts on its first day, one day when there is no estimate", () => {
    const s = sprintSlot({ startDate: null, estimateHours: null }, sprint(), "2026-11-01");
    assert.ok(s);
    assert.equal(s.startDate, "2026-11-02");
    assert.equal(s.durationDays, 1);
    assert.equal(s.sprintEnd, "2026-11-16");
  });

  it("a running sprint starts today, not on its first day", () => {
    assert.equal(sprintSlot({ startDate: null, estimateHours: null }, sprint({ state: "active" }), "2026-11-05")?.startDate, "2026-11-05");
  });

  it("duration is the estimate in 8-hour days, rounded up", () => {
    assert.equal(sprintSlot({ startDate: null, estimateHours: 20 }, sprint(), "2026-11-01")?.durationDays, 3);
    assert.equal(sprintSlot({ startDate: null, estimateHours: 8 }, sprint(), "2026-11-01")?.durationDays, 1);
  });

  it("nothing to place: a task that already has dates, or a sprint without them", () => {
    assert.equal(sprintSlot({ startDate: "2026-11-03", estimateHours: null }, sprint(), "2026-11-01"), null);
    assert.equal(sprintSlot({ startDate: null, estimateHours: null }, sprint({ startDate: null }), "2026-11-01"), null);
  });

  it("an overdue running sprint pins the start to its last day", () => {
    assert.equal(sprintSlot({ startDate: null, estimateHours: null }, sprint({ state: "active" }), "2026-11-30")?.startDate, "2026-11-16");
  });

  it("slotEnd is inclusive", () => {
    assert.equal(slotEnd({ startDate: "2026-11-02", durationDays: 3 }), "2026-11-04");
  });
});
