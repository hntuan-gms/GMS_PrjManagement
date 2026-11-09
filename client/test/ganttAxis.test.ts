import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { axisOrigin, dayNumber, dayToPx, pxToDay, scrollKeeping } from "../src/ganttAxis";

describe("axisOrigin", () => {
  it("is one step before the earliest bar, as the library seeds it", () => {
    assert.equal(axisOrigin("day", "2026-11-03"), "2026-11-02");
    assert.equal(axisOrigin("week", "2026-11-04"), "2026-10-26"); // Monday 02/11, one week earlier
    assert.equal(axisOrigin("month", "2026-11-20"), "2026-10-01");
    assert.equal(axisOrigin("month", "2026-01-15"), "2025-12-01");
  });
});

describe("pxToDay / dayToPx", () => {
  const cases = [
    ["day", 60],
    ["week", 160],
    ["month", 100],
  ] as const;
  for (const [mode, w] of cases) {
    it(`${mode}: round trip`, () => {
      const origin = axisOrigin(mode, "2026-03-10");
      for (const px of [0, 1, w - 1, w, 3.5 * w, 40 * w + 7]) {
        assert.ok(Math.abs(dayToPx(mode, origin, w, pxToDay(mode, origin, w, px)) - px) < 1e-6, `${mode} ${px}`);
      }
    });
  }

  it("month columns are one width however long the month is", () => {
    const origin = axisOrigin("month", "2026-01-10"); // 2025-12-01
    assert.equal(dayToPx("month", origin, 100, dayNumber("2026-01-01")), 100);
    assert.equal(dayToPx("month", origin, 100, dayNumber("2026-02-01")), 200);
    assert.equal(dayToPx("month", origin, 100, dayNumber("2026-03-01")), 300);
  });
});

describe("scrollKeeping", () => {
  it("keeps a date under the pointer across the day → week → month handoffs", () => {
    const earliest = "2026-06-01";
    const date = dayNumber("2026-09-15");
    // Under the pointer in day columns…
    let scroll = scrollKeeping("day", axisOrigin("day", earliest), 30, date, 20);
    // …and the same date is read back from that scroll position in each kind of column.
    for (const [mode, w] of [
      ["day", 30],
      ["week", 182],
      ["week", 40],
      ["month", 113],
      ["month", 30],
    ] as const) {
      const origin = axisOrigin(mode, earliest);
      scroll = scrollKeeping(mode, origin, w, date, 20);
      const back = pxToDay(mode, origin, w, scroll + 20);
      assert.ok(Math.abs(back - date) < 1e-6, `${mode} ${w}`);
    }
  });

  it("never asks for a negative scroll", () => {
    const origin = axisOrigin("day", "2026-06-01");
    assert.equal(scrollKeeping("day", origin, 30, dayNumber("2026-06-01"), 500), 0);
  });
});
