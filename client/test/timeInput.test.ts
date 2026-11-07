import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatTime, parseTime, timeToMinutes } from "../src/timeInput";

describe("parseTime", () => {
  it("reads the ways people type an hour", () => {
    assert.equal(parseTime("8"), "08:00");
    assert.equal(parseTime("8h"), "08:00");
    assert.equal(parseTime("20h"), "20:00");
    assert.equal(parseTime("20"), "20:00");
    assert.equal(parseTime("0"), "00:00");
  });

  it("reads hours and minutes", () => {
    assert.equal(parseTime("8:30"), "08:30");
    assert.equal(parseTime("08:30"), "08:30");
    assert.equal(parseTime("8h30"), "08:30");
    assert.equal(parseTime("17:05"), "17:05");
    assert.equal(parseTime("13.15"), "13:15");
  });

  it("reads four digits and three digits", () => {
    assert.equal(parseTime("0830"), "08:30");
    assert.equal(parseTime("1700"), "17:00");
    assert.equal(parseTime("830"), "08:30");
  });

  it("ignores case and spaces", () => {
    assert.equal(parseTime("  8 H 30 "), "08:30");
    assert.equal(parseTime("9H"), "09:00");
  });

  it("refuses what is not a time of day", () => {
    for (const bad of ["", " ", "24", "24:00", "8:60", "2560", "abc", "8:3:1", "8pm", "-1", "123456"]) {
      assert.equal(parseTime(bad), null, bad);
    }
  });
});

describe("formatTime / timeToMinutes", () => {
  it("pads to HH:mm", () => {
    assert.equal(formatTime(8, 5), "08:05");
  });
  it("measures minutes after midnight", () => {
    assert.equal(timeToMinutes("08:30"), 510);
    assert.equal(timeToMinutes("24:00"), null);
    assert.equal(timeToMinutes("8:30"), null);
  });
});
