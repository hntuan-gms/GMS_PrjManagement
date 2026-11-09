import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { durationBetween, endDateOf, shortDate } from "../src/taskForm";

describe("endDateOf", () => {
  it("is start + duration − 1 (inclusive), across a month and year end", () => {
    assert.equal(endDateOf("2026-11-02", 3), "2026-11-04");
    assert.equal(endDateOf("2026-11-02", 1), "2026-11-02");
    assert.equal(endDateOf("2026-10-30", 4), "2026-11-02");
    assert.equal(endDateOf("2026-12-30", 3), "2027-01-01");
  });

  it("takes the next whole day for a fraction, like the server", () => {
    assert.equal(endDateOf("2026-11-02", 1.5), "2026-11-03");
    assert.equal(endDateOf("2026-11-02", 0.1), "2026-11-02");
  });

  it("gives nothing for a start that isn't a date", () => {
    assert.equal(endDateOf("", 3), null);
    assert.equal(endDateOf("2026-11", 3), null);
    assert.equal(endDateOf("2026-11-02", Number.NaN), null);
  });
});

describe("shortDate", () => {
  it("drops the year only when it matches the start's", () => {
    assert.equal(shortDate("2026-11-04", "2026-11-02"), "04/11");
    assert.equal(shortDate("2027-01-01", "2026-12-30"), "01/01/2027");
    assert.equal(shortDate("2026-11-04"), "04/11/2026");
  });
});

describe("durationBetween", () => {
  it("counts both days", () => {
    assert.equal(durationBetween("2026-11-02", "2026-11-04"), 3);
    assert.equal(durationBetween("2026-11-02", "2026-11-02"), 1);
  });
  it("is the inverse of endDateOf", () => {
    for (const n of [1, 5, 31, 90]) assert.equal(durationBetween("2026-11-30", endDateOf("2026-11-30", n)!), n);
  });
  it("an end before the start is one day, an unreadable one is nothing", () => {
    assert.equal(durationBetween("2026-11-10", "2026-11-01"), 1);
    assert.equal(durationBetween("2026-11-10", "nope"), null);
  });
});
