import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toCsv } from "../src/csv";
import { formatPredecessors, overlayCsvCells, overlayCsvHeader } from "../src/wbsExport";
import { task } from "./fixtures";

describe("WBS overlay columns", () => {
  it("spells dependencies with type and signed lag", () => {
    assert.equal(
      formatPredecessors([
        { taskId: "D-3", type: "FS", lagDays: 0 },
        { taskId: "D-4", type: "SS", lagDays: 2 },
        { taskId: "D-5", type: "FF", lagDays: -1 },
      ]),
      "D-3 FS; D-4 SS+2; D-5 FF-1"
    );
  });

  it("adds % only when it isn't already a visible column", () => {
    assert.deepEqual(overlayCsvHeader(false), ["Phụ thuộc (việc trước)", "Baseline bắt đầu", "Baseline kết thúc", "Lệch baseline (ngày)"]);
    assert.equal(overlayCsvHeader(true)[0], "% hoàn thành");
  });

  it("writes the resolved baseline and a numeric slip (negative stays a number, not a neutralised string)", () => {
    const t = task({ id: "D-1", summary: "x", percentComplete: 40, predecessors: [{ taskId: "D-0", type: "FS", lagDays: 0 }] });
    const cells = overlayCsvCells(t, { start: "2026-10-01", end: "2026-10-08" }, { start: "2026-10-01", end: "2026-10-10" }, true);
    assert.deepEqual(cells, [40, "D-0 FS", "2026-10-01", "2026-10-10", -2]);
    assert.ok(toCsv([cells]).includes(",-2\r\n"));
  });

  it("leaves baseline cells empty for a task without one", () => {
    const t = task({ id: "D-2", summary: "y", baselineStart: null, baselineDue: null });
    assert.deepEqual(overlayCsvCells(t, { start: "2026-10-01", end: "2026-10-10" }, undefined, false), ["", null, null, null]);
  });
});
