import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppError } from "../src/errors.js";
import { DEFAULT_SLA_SETTINGS, validateSlaSettings, withSlaDefaults } from "../src/sla.js";

function rejects(raw: unknown, pattern: RegExp) {
  assert.throws(() => validateSlaSettings(raw), (e: unknown) => e instanceof AppError && e.status === 400 && pattern.test(e.message));
}

const valid = { ...DEFAULT_SLA_SETTINGS, enabled: true, appliesFrom: "2026-10-01" };

describe("validateSlaSettings", () => {
  it("accepts the defaults as they are", () => {
    assert.deepEqual(validateSlaSettings(DEFAULT_SLA_SETTINGS), DEFAULT_SLA_SETTINGS);
  });

  it("sorts periods and holidays, drops duplicates, empty names and unknown keys", () => {
    const out = validateSlaSettings({
      ...valid,
      periods: [
        { start: "13:00", end: "17:00" },
        { start: "08:00", end: "12:00" },
      ],
      holidays: [
        { date: "2026-09-02", name: "Quốc khánh" },
        { date: "2026-01-01", name: " Tết Dương lịch " },
        { date: "2026-09-02", name: "trùng" },
      ],
      targets: [
        { priority: "High", hours: "16" },
        { priority: "high", hours: 1 },
        { priority: " ", hours: 2 },
        { priority: "Lowest", hours: "" },
      ],
      workDays: [5, 1, 1, 9, 3],
      issueTypes: ["Bug", "Bug", ""],
      somethingElse: true,
    });
    assert.deepEqual(out.periods.map((p) => p.start), ["08:00", "13:00"]);
    assert.deepEqual(out.holidays, [
      { date: "2026-01-01", name: "Tết Dương lịch" },
      { date: "2026-09-02", name: "Quốc khánh" },
    ]);
    assert.deepEqual(out.targets, [
      { priority: "High", hours: 16 },
      { priority: "Lowest", hours: null },
    ]);
    assert.deepEqual(out.workDays, [1, 3, 5]);
    assert.deepEqual(out.issueTypes, ["Bug"]);
    assert.equal("somethingElse" in out, false);
  });

  it("only true switches SLA on", () => {
    assert.equal(validateSlaSettings({ ...valid, enabled: "yes" }).enabled, false);
  });

  it("refuses a calendar the clock cannot run on", () => {
    rejects({ ...valid, workDays: [] }, /ngày làm việc/);
    rejects({ ...valid, workDays: [8] }, /ngày làm việc/);
    rejects({ ...valid, periods: [] }, /khung giờ/);
    rejects({ ...valid, periods: [{ start: "8:00", end: "12:00" }] }, /HH:mm/);
    rejects({ ...valid, periods: [{ start: "12:00", end: "08:00" }] }, /kết thúc sau/);
    rejects(
      {
        ...valid,
        periods: [
          { start: "08:00", end: "12:30" },
          { start: "12:00", end: "17:00" },
        ],
      },
      /chồng nhau/
    );
    rejects({ ...valid, periods: Array.from({ length: 4 }, (_, i) => ({ start: `0${i}:00`, end: `0${i}:30` })) }, /1 đến 3/);
    rejects({ ...valid, holidays: [{ date: "2026-02-30", name: "x" }] }, /ngày lễ/);
    rejects({ ...valid, tzOffsetMinutes: 2000 }, /múi giờ/);
  });

  it("refuses targets and thresholds that make no sense", () => {
    rejects({ ...valid, targets: [{ priority: "High", hours: 0 }] }, /High/);
    rejects({ ...valid, targets: [{ priority: "High", hours: -2 }] }, /High/);
    rejects({ ...valid, targets: [{ priority: "High", hours: "abc" }] }, /High/);
    rejects({ ...valid, warnPercent: 95 }, /Sắp trễ/);
    rejects({ ...valid, warnPercent: 12.5 }, /Sắp trễ/);
    rejects({ ...valid, appliesFrom: "01/10/2026" }, /Áp dụng/);
  });
});

describe("withSlaDefaults", () => {
  it("no row means the defaults, switched off", () => {
    const d = withSlaDefaults(null);
    assert.deepEqual(d, DEFAULT_SLA_SETTINGS);
    assert.equal(d.enabled, false);
    d.targets[0].hours = 99; // a copy, never the shared default
    assert.equal(DEFAULT_SLA_SETTINGS.targets[0].hours, 4);
  });

  it("a row saved before a field existed gets that field's default", () => {
    const d = withSlaDefaults({ enabled: true, workDays: [1, 2, 3, 4, 5, 6] });
    assert.equal(d.enabled, true);
    assert.deepEqual(d.workDays, [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(d.periods, DEFAULT_SLA_SETTINGS.periods);
  });
});
