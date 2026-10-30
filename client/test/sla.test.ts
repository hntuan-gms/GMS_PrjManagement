import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addWorkingMs,
  computeSla,
  formatSlaInstant,
  formatWorkingDuration,
  makeCalendar,
  slaFor,
  slaIds,
  slaShortText,
  workingMsBetween,
} from "../src/sla";
import type { SlaSettings } from "../src/types";
import { task } from "./fixtures";

const H = 3_600_000;
/** An instant written in Vietnam time. 2026-10-05 is a Monday. */
const vn = (local: string) => Date.parse(`${local}:00+07:00`);

const policy = (o: Partial<SlaSettings> = {}): SlaSettings => ({
  enabled: true,
  appliesFrom: null,
  targets: [
    { priority: "Highest", hours: 4 },
    { priority: "High", hours: 16 },
    { priority: "Medium", hours: 40 },
    { priority: "Lowest", hours: null },
  ],
  warnPercent: 25,
  issueTypes: [],
  workDays: [1, 2, 3, 4, 5],
  periods: [
    { start: "08:00", end: "12:00" },
    { start: "13:00", end: "17:00" },
  ],
  holidays: [],
  tzOffsetMinutes: 420,
  ...o,
});

const cal = makeCalendar(policy());

describe("workingMsBetween", () => {
  it("skips the lunch break", () => {
    assert.equal(workingMsBetween(vn("2026-10-05T10:00"), vn("2026-10-05T14:00"), cal), 3 * H);
  });

  it("skips nights and the weekend", () => {
    assert.equal(workingMsBetween(vn("2026-10-09T16:00"), vn("2026-10-12T09:00"), cal), 2 * H);
  });

  it("skips holidays", () => {
    const withHoliday = makeCalendar(policy({ holidays: [{ date: "2026-10-12", name: "Nghỉ bù" }] }));
    assert.equal(workingMsBetween(vn("2026-10-09T16:00"), vn("2026-10-12T09:00"), withHoliday), 1 * H);
    assert.equal(workingMsBetween(vn("2026-10-09T16:00"), vn("2026-10-13T09:00"), withHoliday), 2 * H);
  });

  it("is zero for an empty or backward span", () => {
    assert.equal(workingMsBetween(vn("2026-10-05T10:00"), vn("2026-10-05T10:00"), cal), 0);
    assert.equal(workingMsBetween(vn("2026-10-05T14:00"), vn("2026-10-05T10:00"), cal), 0);
  });
});

describe("addWorkingMs", () => {
  it("carries over lunch and over the weekend", () => {
    assert.equal(addWorkingMs(vn("2026-10-05T11:00"), 4 * H, cal), vn("2026-10-05T16:00"));
    assert.equal(addWorkingMs(vn("2026-10-09T15:00"), 4 * H, cal), vn("2026-10-12T10:00"));
  });

  it("work created outside working time starts at the next period", () => {
    assert.equal(addWorkingMs(vn("2026-10-10T20:00"), 4 * H, cal), vn("2026-10-12T12:00"));
    assert.equal(addWorkingMs(vn("2026-10-05T12:30"), 1 * H, cal), vn("2026-10-05T14:00"));
  });

  it("is the inverse of workingMsBetween", () => {
    for (const [from, hours] of [
      ["2026-10-05T07:15", 3],
      ["2026-10-07T16:40", 9.5],
      ["2026-10-09T11:59", 40],
      ["2026-10-11T23:00", 1],
    ] as const) {
      const start = vn(from);
      const due = addWorkingMs(start, hours * H, cal);
      assert.equal(workingMsBetween(start, due, cal), hours * H, from);
    }
  });

  it("reads days in the policy's timezone, not the machine's", () => {
    // 01:00 UTC on Monday is 08:00 in Vietnam (working) but 01:00 in UTC (not yet).
    const start = Date.parse("2026-10-05T01:00:00Z");
    assert.equal(addWorkingMs(start, 1 * H, cal), Date.parse("2026-10-05T02:00:00Z"));
    const utc = makeCalendar(policy({ tzOffsetMinutes: 0 }));
    assert.equal(addWorkingMs(start, 1 * H, utc), Date.parse("2026-10-05T09:00:00Z"));
  });
});

describe("slaFor", () => {
  const created = "2026-10-05T09:00:00.000+0700"; // Monday 09:00
  const t = (o: Parameters<typeof task>[0]) => task({ createdAt: created, ...o });

  it("open work: within, warning, breached", () => {
    const s = policy();
    const highest = t({ id: "A-1", summary: "", priority: "Highest" }); // due Monday 14:00
    assert.equal(slaFor(highest, s, vn("2026-10-05T10:00"))?.state, "ok");
    const warn = slaFor(highest, s, vn("2026-10-05T13:30"));
    assert.equal(warn?.state, "warn");
    assert.equal(warn?.remainingMs, 0.5 * H);
    const late = slaFor(highest, s, vn("2026-10-06T09:00"));
    assert.equal(late?.state, "breached");
    assert.equal(late?.dueMs, vn("2026-10-05T14:00"));
    assert.equal(late?.remainingMs, -4 * H); // 14:00–17:00 Monday + 08:00–09:00 Tuesday
  });

  it("finished work is judged by when it was resolved", () => {
    const s = policy();
    const met = t({ id: "A-2", summary: "", priority: "Highest", statusCategory: "done", resolvedAt: "2026-10-05T11:00:00.000+0700" });
    assert.deepEqual(slaFor(met, s, vn("2026-12-01T09:00")), { state: "met", targetHours: 4, dueMs: vn("2026-10-05T14:00"), remainingMs: 2 * H });
    const missed = t({ id: "A-3", summary: "", priority: "Highest", statusCategory: "done", resolvedAt: "2026-10-05T16:00:00.000+0700" });
    assert.equal(slaFor(missed, s, vn("2026-12-01T09:00"))?.state, "missed");
    assert.equal(slaFor(missed, s, vn("2026-12-01T09:00"))?.remainingMs, -2 * H);
  });

  it("measures nothing it should not", () => {
    const s = policy();
    const now = vn("2026-10-06T09:00");
    assert.equal(slaFor(t({ id: "B-1", summary: "", priority: "Highest" }), policy({ enabled: false }), now), null);
    assert.equal(slaFor(t({ id: "B-2", summary: "", priority: "Highest", issueType: "Epic" }), s, now), null);
    assert.equal(slaFor(t({ id: "B-3", summary: "", priority: "Lowest" }), s, now), null, "no target for Lowest");
    assert.equal(slaFor(t({ id: "B-4", summary: "", priority: "Low" }), s, now), null, "no row for Low");
    assert.equal(slaFor(t({ id: "B-5", summary: "", priority: null }), s, now), null);
    assert.equal(slaFor(task({ id: "B-6", summary: "", priority: "Highest" }), s, now), null, "no createdAt (old cache)");
    assert.equal(
      slaFor(t({ id: "B-7", summary: "", priority: "Highest", statusCategory: "done", resolvedAt: null }), s, now),
      null,
      "done with no resolution time"
    );
    assert.equal(slaFor(t({ id: "B-8", summary: "", priority: "Highest" }), policy({ appliesFrom: "2026-10-06" }), now), null);
    assert.ok(slaFor(t({ id: "B-9", summary: "", priority: "Highest" }), policy({ appliesFrom: "2026-10-05" }), now));
  });

  it("an issue-type list replaces the Epic default; priority names match without case", () => {
    const now = vn("2026-10-05T10:00");
    const bugsOnly = policy({ issueTypes: ["Bug"] });
    assert.equal(slaFor(t({ id: "C-1", summary: "", priority: "Highest", issueType: "Task" }), bugsOnly, now), null);
    assert.ok(slaFor(t({ id: "C-2", summary: "", priority: "highest", issueType: "Bug" }), bugsOnly, now));
  });

  it("warnPercent 0 never warns", () => {
    const r = slaFor(t({ id: "D-1", summary: "", priority: "Highest" }), policy({ warnPercent: 0 }), vn("2026-10-05T13:59"));
    assert.equal(r?.state, "ok");
  });
});

describe("computeSla / slaIds", () => {
  it("maps only measured tasks, and is empty while SLA is off", () => {
    const tasks = [
      task({ id: "E-1", summary: "", priority: "Highest", createdAt: "2026-10-05T09:00:00+07:00" }),
      task({ id: "E-2", summary: "", priority: "Lowest", createdAt: "2026-10-05T09:00:00+07:00" }),
    ];
    const now = vn("2026-10-06T09:00");
    const sla = computeSla(tasks, policy(), now);
    assert.deepEqual([...sla.keys()], ["E-1"]);
    assert.deepEqual([...slaIds(sla, "breached")], ["E-1"]);
    assert.equal(computeSla(tasks, policy({ enabled: false }), now).size, 0);
    assert.equal(computeSla(tasks, null, now).size, 0);
  });
});

describe("wording", () => {
  const s = policy();
  it("a day is a working day, at most two units", () => {
    assert.equal(formatWorkingDuration(9.5 * H, s), "1 ngày 1 giờ");
    assert.equal(formatWorkingDuration(9.5 * H, s, true), "1n1g");
    assert.equal(formatWorkingDuration(-(3 * H + 20 * 60_000), s), "3 giờ 20 phút");
    assert.equal(formatWorkingDuration(45 * 60_000, s, true), "45p");
    assert.equal(formatWorkingDuration(10_000, s), "dưới 1 phút");
  });

  it("instants are shown in the policy's timezone", () => {
    const now = vn("2026-10-30T09:00");
    assert.equal(formatSlaInstant(vn("2026-10-31T15:05"), s, now), "31/10 15:05");
    assert.equal(formatSlaInstant(vn("2027-01-02T08:00"), s, now), "02/01/2027 08:00");
  });

  it("chip text", () => {
    const r = { targetHours: 4, dueMs: 0 };
    assert.equal(slaShortText({ ...r, state: "ok", remainingMs: 3 * H }, s), "Còn 3g");
    assert.equal(slaShortText({ ...r, state: "breached", remainingMs: -9 * H }, s), "Trễ 1n1g");
    assert.equal(slaShortText({ ...r, state: "met", remainingMs: H }, s), "Đúng hạn");
    assert.equal(slaShortText({ ...r, state: "missed", remainingMs: -H }, s), "Xong trễ 1g");
  });
});
