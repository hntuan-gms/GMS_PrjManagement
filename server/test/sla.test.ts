import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppError } from "../src/errors.js";
import { calendarOf, DEFAULT_SLA_SETTINGS, slaFieldsOf, validateCalendar, validateSlaSettings, withSlaDefaults } from "../src/sla.js";

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

describe("validateCalendar", () => {
  const ok = { workDays: [1, 2, 3, 4, 5], holidays: [], makeUpDays: [], periods: DEFAULT_SLA_SETTINGS.periods, tzOffsetMinutes: 420 };
  const refuses = (raw: unknown, pattern: RegExp) =>
    assert.throws(() => validateCalendar(raw), (e: unknown) => e instanceof AppError && e.status === 400 && /^Lịch làm việc:/.test(e.message) && pattern.test(e.message));

  it("keeps only the calendar fields, sorted and de-duplicated", () => {
    const out = validateCalendar({
      ...ok,
      makeUpDays: [
        { date: "2027-02-20", name: "Làm bù" },
        { date: "2027-01-30", name: " Làm bù Tết " },
        { date: "2027-01-30", name: "trùng" },
      ],
      enabled: true,
    });
    assert.deepEqual(out, {
      workDays: [1, 2, 3, 4, 5],
      holidays: [],
      makeUpDays: [
        { date: "2027-01-30", name: "Làm bù Tết" },
        { date: "2027-02-20", name: "Làm bù" },
      ],
      periods: DEFAULT_SLA_SETTINGS.periods,
      tzOffsetMinutes: 420,
    });
  });

  it("owns the working hours of the day and the timezone", () => {
    refuses({ ...ok, periods: [] }, /khung giờ/);
    refuses({ ...ok, periods: [{ start: "08:00", end: "12:00" }, { start: "11:00", end: "17:00" }] }, /chồng nhau/);
    refuses({ ...ok, tzOffsetMinutes: 9999 }, /múi giờ/);
    const out = validateCalendar({ ...ok, periods: [{ start: "13:00", end: "17:00" }, { start: "08:00", end: "12:00" }], tzOffsetMinutes: 0 });
    assert.deepEqual(out.periods, [{ start: "08:00", end: "12:00" }, { start: "13:00", end: "17:00" }]);
    assert.equal(out.tzOffsetMinutes, 0);
  });

  it("refuses a bad make-up day, and a day that is both a holiday and a make-up day", () => {
    refuses({ ...ok, makeUpDays: [{ date: "2027-02-30", name: "x" }] }, /ngày làm bù/);
    refuses({ ...ok, holidays: [{ date: "2027-02-06", name: "Tết" }], makeUpDays: [{ date: "2027-02-06", name: "x" }] }, /06\/02\/2027.*vừa là ngày lễ vừa là ngày làm bù/);
    refuses({ ...ok, workDays: [] }, /ngày làm việc/);
  });

  it("splits a policy into its calendar and SLA parts without losing a field", () => {
    const s = withSlaDefaults({ enabled: true, makeUpDays: [{ date: "2027-01-30", name: "Làm bù" }] });
    assert.deepEqual(calendarOf(s), { workDays: s.workDays, holidays: s.holidays, makeUpDays: s.makeUpDays, periods: s.periods, tzOffsetMinutes: s.tzOffsetMinutes });
    const sla = slaFieldsOf(s);
    assert.equal("holidays" in sla || "workDays" in sla || "makeUpDays" in sla, false);
    assert.deepEqual({ ...sla, ...calendarOf(s) }, s);
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
    assert.deepEqual(d.makeUpDays, []);
  });
});
