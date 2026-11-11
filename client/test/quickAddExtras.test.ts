import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NO_EXTRAS, hasExtras, mergeExtras } from "../src/quickAddExtras";

describe("quickAddExtras", () => {
  it("empty boxes change nothing", () => {
    const r = mergeExtras({ startDate: "2026-11-02", durationDays: 3, assigneeAccountId: "a" }, NO_EXTRAS);
    assert.deepEqual(r, { ok: true, fields: { startDate: "2026-11-02", durationDays: 3, assigneeAccountId: "a" } });
    assert.equal(hasExtras(NO_EXTRAS), false);
  });

  it("both dates: duration counts both ends, and beats the sentence", () => {
    const r = mergeExtras({ startDate: "2026-01-01", durationDays: 9 }, { ...NO_EXTRAS, startDate: "2026-11-02", dueDate: "2026-11-06" });
    assert.deepEqual(r, { ok: true, fields: { startDate: "2026-11-02", durationDays: 5 } });
  });

  it("same day is one day", () => {
    const r = mergeExtras({}, { ...NO_EXTRAS, startDate: "2026-11-02", dueDate: "2026-11-02" });
    assert.deepEqual(r, { ok: true, fields: { startDate: "2026-11-02", durationDays: 1 } });
  });

  it("start only keeps the sentence's duration", () => {
    const r = mergeExtras({ durationDays: 4 }, { ...NO_EXTRAS, startDate: "2026-11-02" });
    assert.deepEqual(r, { ok: true, fields: { startDate: "2026-11-02", durationDays: 4 } });
  });

  it("due only is one day ending on it", () => {
    const r = mergeExtras({ durationDays: 4 }, { ...NO_EXTRAS, dueDate: "2026-11-06" });
    assert.deepEqual(r, { ok: true, fields: { startDate: "2026-11-06", durationDays: 1 } });
  });

  it("due before start is refused", () => {
    const r = mergeExtras({}, { ...NO_EXTRAS, startDate: "2026-11-06", dueDate: "2026-11-02" });
    assert.equal(r.ok, false);
  });

  it("the assignee box wins over @name", () => {
    const r = mergeExtras({ assigneeAccountId: "a" }, { ...NO_EXTRAS, assigneeAccountId: "b" });
    assert.deepEqual(r, { ok: true, fields: { assigneeAccountId: "b" } });
  });
});
