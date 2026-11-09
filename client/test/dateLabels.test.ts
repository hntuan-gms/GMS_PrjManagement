import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatRange, fullDate, monthColumnLabel, monthLabels, shortDay, shortRange, weekColumnLabel } from "../src/dateLabels";

describe("dateLabels", () => {
  it("writes a month in three lengths", () => {
    assert.deepEqual(monthLabels("2026-10-28"), { full: "Tháng 10/2026", short: "T10/26", tiny: "T10" });
    assert.deepEqual(monthLabels("2027-01-01"), { full: "Tháng 1/2027", short: "T1/27", tiny: "T1" });
  });

  it("names a week column by the day it starts on", () => {
    assert.equal(weekColumnLabel("2026-11-02"), "02/11");
    assert.equal(weekColumnLabel("2026-12-28"), "28/12");
  });

  it("writes DD/MM/YYYY", () => {
    assert.equal(fullDate("2026-11-02"), "02/11/2026");
  });

  it("writes a range with the year once at the end", () => {
    assert.equal(formatRange("2026-11-02", "2026-11-08"), "02/11 – 08/11/2026");
    assert.equal(formatRange("2026-10-30", "2026-11-05"), "30/10 – 05/11/2026");
  });

  it("writes both years when a range crosses New Year, and a single day alone", () => {
    assert.equal(formatRange("2026-12-28", "2027-01-03"), "28/12/2026 – 03/01/2027");
    assert.equal(formatRange("2026-11-02", "2026-11-02"), "02/11/2026");
  });

  it("writes a short span for a chip", () => {
    assert.equal(shortRange("2026-11-12", "2026-11-12"), "12/11");
    assert.equal(shortRange("2026-11-12", "2026-11-14"), "12–14/11");
    assert.equal(shortRange("2026-10-30", "2026-11-02"), "30/10–02/11");
  });

  it("writes one date as D/M, with the year only when it is another year", () => {
    assert.equal(shortDay("2026-09-16", "2026-11-07"), "16/9");
    assert.equal(shortDay("2027-09-16", "2026-11-07"), "16/9/2027");
    assert.equal(shortDay("2025-01-05", "2026-11-07"), "5/1/2025");
  });

  it("never goes through Date, so the zone cannot move a label", () => {
    const old = process.env.TZ;
    for (const tz of ["Asia/Ho_Chi_Minh", "America/Los_Angeles", "Pacific/Kiritimati"]) {
      process.env.TZ = tz;
      assert.equal(weekColumnLabel("2026-11-02"), "02/11");
      assert.equal(shortDay("2026-01-01", "2026-06-01"), "1/1");
    }
    process.env.TZ = old;
  });
});

describe("monthColumnLabel", () => {
  it("cuts a month column's label to what the column holds", () => {
    assert.equal(monthColumnLabel("Tháng 11", 110), "Tháng 11");
    assert.equal(monthColumnLabel("Tháng 11", 64), "Tháng 11");
    assert.equal(monthColumnLabel("Tháng 11", 63), "T11");
    assert.equal(monthColumnLabel("Tháng 11", 36), "T11");
    assert.equal(monthColumnLabel("Tháng 11", 35), "11");
    assert.equal(monthColumnLabel("Tháng 1", 26), "1");
  });

  it("reads a label already shortened the same, so the pass can run again after a zoom", () => {
    assert.equal(monthColumnLabel("T11", 110), "Tháng 11");
    assert.equal(monthColumnLabel("11", 40), "T11");
  });
});
