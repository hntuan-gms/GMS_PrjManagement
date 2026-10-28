import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateMonths,
  aggregateWeeks,
  monthWindow,
  type DayLoad,
} from "../src/resourceAllocation";

const day = (date: string, capacityHours: number, allocatedHours: number): DayLoad => ({
  date,
  capacityHours,
  allocatedHours,
  ratio: capacityHours > 0 ? allocatedHours / capacityHours : 0,
  band: capacityHours > 0 ? "healthy" : "off",
  taskIds: allocatedHours > 0 ? ["T-1"] : [],
  offReason: capacityHours > 0 ? null : "weekend",
});

describe("heatmap windows (3.13)", () => {
  it("monthWindow covers the whole calendar month, leap February included", () => {
    assert.deepEqual(monthWindow("2026-10-15"), { from: "2026-10-01", to: "2026-10-31" });
    assert.deepEqual(monthWindow("2028-02-10"), { from: "2028-02-01", to: "2028-02-29" });
    assert.deepEqual(monthWindow("2026-12-31"), { from: "2026-12-01", to: "2026-12-31" });
  });


  it("a month cell carries the month's real totals, and a week cell stays within its week", () => {
    const days = [
      day("2026-10-30", 8, 8), // Fri
      day("2026-10-31", 0, 0), // Sat
      day("2026-11-02", 8, 4), // Mon
      day("2026-11-03", 8, 4),
    ];
    const months = aggregateMonths(days);
    assert.equal(months.length, 2);
    assert.deepEqual([months[0].start, months[0].end], ["2026-10-30", "2026-10-31"]);
    assert.equal(months[1].allocatedHours, 8);
    assert.equal(months[1].capacityHours, 16);
    assert.equal(months[1].ratio, 0.5);
    // The same days by week: Monday starts the second.
    assert.deepEqual(aggregateWeeks(days).map((w) => w.start), ["2026-10-30", "2026-11-02"]);
  });
});
