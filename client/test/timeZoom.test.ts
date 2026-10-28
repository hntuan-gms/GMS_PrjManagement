import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_PIXELS_PER_DAY,
  MAX_PIXELS_PER_DAY,
  MIN_CELL,
  MIN_PIXELS_PER_DAY,
  pickScale,
  zoomByWheel,
} from "../src/timeZoom";

describe("pickScale", () => {
  it("each mode's default lands in its own band", () => {
    for (const g of ["day", "week", "month"] as const) {
      assert.equal(pickScale(DEFAULT_PIXELS_PER_DAY[g]).granularity, g);
    }
    assert.equal(pickScale(DEFAULT_PIXELS_PER_DAY.day).cellWidth, MIN_CELL);
  });

  it("hands off day → week → month as the zoom falls, never with a column under the minimum", () => {
    let last = "day";
    const order = ["day", "week", "month"];
    for (let ppd = MAX_PIXELS_PER_DAY; ppd >= MIN_PIXELS_PER_DAY; ppd *= 0.97) {
      const { granularity, cellWidth } = pickScale(ppd);
      assert.ok(order.indexOf(granularity) >= order.indexOf(last), `${ppd}: ${last} → ${granularity}`);
      assert.ok(cellWidth >= MIN_CELL - 1e-9, `${ppd}: ${cellWidth}px`);
      last = granularity;
    }
    assert.equal(last, "month");
  });

  it("a column's width follows the zoom inside a mode", () => {
    const a = pickScale(30).cellWidth;
    const b = pickScale(40).cellWidth;
    assert.ok(b > a);
  });
});

describe("zoomByWheel", () => {
  it("scrolling up zooms in, down zooms out", () => {
    assert.ok(zoomByWheel(10, -100) > 10);
    assert.ok(zoomByWheel(10, 100) < 10);
  });

  it("stays inside the allowed range however hard it is pushed", () => {
    assert.equal(zoomByWheel(MAX_PIXELS_PER_DAY, -100000), MAX_PIXELS_PER_DAY);
    assert.equal(zoomByWheel(MIN_PIXELS_PER_DAY, 100000), MIN_PIXELS_PER_DAY);
  });
});
