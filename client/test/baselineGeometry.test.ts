import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BASELINE_HEIGHT, baselineBox, baselineTitle, resolveBaselines, slipDays } from "../src/baselineGeometry";
import { orderByWbs } from "../src/ganttMapping";
import { task } from "./fixtures";

describe("resolveBaselines", () => {
  it("an Epic with children spans its children's baselines; others keep their own; none means no entry", () => {
    const tasks = [
      task({ id: "E-1", summary: "Epic", issueType: "Epic", baselineStart: "2026-01-01", baselineDue: "2026-12-31" }),
      task({ id: "E-2", summary: "a", wbsParentId: "E-1", baselineStart: "2026-10-03", baselineDue: "2026-10-05" }),
      task({ id: "E-3", summary: "b", wbsParentId: "E-1", baselineStart: "2026-10-08", baselineDue: "2026-10-12" }),
      task({ id: "E-4", summary: "no baseline", wbsParentId: "E-1", baselineStart: null, baselineDue: null }),
      task({ id: "E-5", summary: "lone epic", issueType: "Epic", baselineStart: "2026-11-01", baselineDue: null }),
    ];
    const b = resolveBaselines(orderByWbs(tasks));
    assert.deepEqual(b.get("E-1"), { start: "2026-10-03", end: "2026-10-12" });
    assert.deepEqual(b.get("E-2"), { start: "2026-10-03", end: "2026-10-05" });
    assert.equal(b.has("E-4"), false);
    // A childless Epic keeps its own; a missing due falls back to the start.
    assert.deepEqual(b.get("E-5"), { start: "2026-11-01", end: "2026-11-01" });
  });
});

describe("baselineBox", () => {
  const bar = { x: 100, y: 8.4, width: 100, height: 25.2 }; // 10 days at 10px/day

  it("anchors on the bar's own left edge and scale, under the bar", () => {
    const box = baselineBox(bar, { start: "2026-10-04", end: "2026-10-13" }, { start: "2026-10-01", end: "2026-10-05" }, 99, 1000)!;
    assert.equal(box.x, 70);
    assert.equal(box.width, 50);
    assert.ok(box.y >= bar.y + bar.height);
    assert.equal(box.height, BASELINE_HEIGHT);
  });

  it("uses the zoom's px/day for a bar drawn at the library's minimum width", () => {
    const small = { ...bar, width: 16 };
    const box = baselineBox(small, { start: "2026-10-04", end: "2026-10-04" }, { start: "2026-10-04", end: "2026-10-06" }, 4, 1000)!;
    assert.equal(box.x, 100);
    assert.equal(box.width, 12);
  });

  it("is clipped to the chart and null when entirely off it", () => {
    const left = baselineBox(bar, { start: "2026-10-04", end: "2026-10-13" }, { start: "2026-09-01", end: "2026-10-05" }, 1, 1000)!;
    assert.equal(left.x, 0);
    assert.equal(baselineBox(bar, { start: "2026-10-04", end: "2026-10-13" }, { start: "2026-01-01", end: "2026-01-02" }, 1, 1000), null);
  });
});

describe("slip", () => {
  it("is positive when the bar now ends after its baseline", () => {
    assert.equal(slipDays({ start: "2026-10-04", end: "2026-10-13" }, { start: "2026-10-01", end: "2026-10-10" }), 3);
    assert.equal(slipDays({ start: "2026-10-01", end: "2026-10-08" }, { start: "2026-10-01", end: "2026-10-10" }), -2);
    assert.equal(baselineTitle({ start: "2026-10-01", end: "2026-10-10" }, 3), "Baseline: 01/10/2026 – 10/10/2026 · Trễ 3 ngày so với baseline");
    assert.match(baselineTitle({ start: "2026-10-01", end: "2026-10-10" }, -2), /Sớm 2 ngày/);
    assert.match(baselineTitle({ start: "2026-10-01", end: "2026-10-10" }, 0), /Đúng baseline/);
  });
});
