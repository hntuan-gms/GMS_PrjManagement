import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cellTooltip,
  formatDate,
  monthLabel,
  scrubExtent,
} from "../src/resourceTimeline";
import type { Task } from "../src/types";

describe("resource tab labels", () => {
  it("writes dates day-first", () => {
    assert.equal(formatDate("2026-11-01"), "01/11/2026");
  });

  it("a day off says so instead of 0h / 0h", () => {
    const off = { start: "2026-11-01", end: "2026-11-01", allocated: 0, capacity: 0, ratio: 0, taskIds: [] };
    assert.equal(cellTooltip(off), "01/11/2026 · Ngày nghỉ");
    assert.equal(
      cellTooltip({ ...off, allocated: 6, taskIds: ["A-1", "A-1"] }),
      "01/11/2026 · Ngày nghỉ · 6h việc bị xếp vào ngày nghỉ\nA-1"
    );
  });

  it("a working day or week keeps the hours, with the range spelled out", () => {
    const day = { start: "2026-11-02", end: "2026-11-02", allocated: 4, capacity: 8, ratio: 0.5, taskIds: ["B-2"] };
    assert.equal(cellTooltip(day), "02/11/2026 · 4h / 8h (50%)\nB-2");
    assert.equal(
      cellTooltip({ ...day, end: "2026-11-08", allocated: 20, capacity: 40, taskIds: [] }),
      "02/11/2026 → 08/11/2026 · 20h / 40h (50%)"
    );
    assert.equal(
      cellTooltip({ ...day, start: "2026-11-01", end: "2026-11-08", capacity: 0, allocated: 0, taskIds: [] }),
      "01/11/2026 → 08/11/2026 · Ngày nghỉ"
    );
  });

  it("gives the month band three lengths, and the year band when columns are months", () => {
    assert.deepEqual(monthLabel("2026-10-28", "day"), { key: "2026-10", full: "Thg 10/2026", mid: "T10/26", min: "T10" });
    assert.equal(monthLabel("2026-10-28", "week").key, monthLabel("2026-10-31", "week").key);
    assert.deepEqual(monthLabel("2026-10-01", "month"), { key: "2026", full: "Năm 2026", mid: "2026", min: "’26" });
  });
});

describe("resource tab time slider", () => {
  const today = "2026-10-28";
  const tasks = [
    { id: "T-1", startDate: "2026-09-01", dueDate: "2026-09-20" },
    { id: "T-2", startDate: "2026-11-10", dueDate: "2026-12-31" },
    { id: "T-3", startDate: null, dueDate: null },
  ] as unknown as Task[];
  const span = { from: "2026-10-28", to: "2026-11-17" };

  it("covers every task, a month back and three ahead, plus a week of margin", () => {
    // Earliest task 1 Sep, latest due 31 Dec — but "three months ahead of today" reaches 26 Jan.
    assert.deepEqual(scrubExtent(tasks, today, span), { from: "2026-08-25", to: "2027-02-02" });
    const longer = [...tasks, { id: "T-4", startDate: "2027-02-01", dueDate: "2027-03-01" }] as unknown as Task[];
    assert.equal(scrubExtent(longer, today, span).to, "2027-03-08");
    assert.deepEqual(scrubExtent([], today, span), { from: "2026-09-21", to: "2027-02-02" });
  });

  it("always contains the window on screen, and survives a task dated far away", () => {
    const far = [{ id: "T-9", startDate: "2099-01-01", dueDate: "2099-02-01" }] as unknown as Task[];
    const e = scrubExtent(far, today, span);
    assert.ok(e.from <= span.from && e.to >= span.to);
    assert.ok(e.to < "2030-01-01", e.to);
  });
});
