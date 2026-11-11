import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { availability } from "../src/agile/sprintMetrics.js";
import { bookingsAnswer } from "../src/ai/bookingAnswer.js";
import type { Booking, Viewer } from "../src/booking.js";
import { bookedWeeks, heldByDay, heldElsewhere, hoursOn } from "../src/bookingLoad.js";
import type { ResourceAbsence } from "../src/resourceStore.js";
import type { JiraUser } from "../src/types.js";
import { DEFAULT_WORK_CALENDAR } from "../src/workCalendar.js";
import { buildWorkload, rankCandidates } from "../src/workload.js";
import { task } from "./fixtures.js";

// Monday 2026-11-16 … Friday 2026-11-20.
const booking = (o: Partial<Booking> = {}): Booking => ({
  id: "1",
  accountId: "a",
  projectKey: "OTHER",
  from: "2026-11-16",
  to: "2026-11-20",
  hoursPerDay: 8,
  status: "confirmed",
  note: "chờ ký hợp đồng",
  createdBy: "pm",
  ...o,
});

const users: JiraUser[] = [
  { accountId: "a", displayName: "An", avatarUrl: null },
  { accountId: "b", displayName: "Bình", avatarUrl: null },
];
const profile = (accountId: string) => ({ accountId, role: null, skills: [], capacityHoursPerDay: 8, costPerDay: null, notes: null });

describe("hoursOn / heldByDay", () => {
  it("a booking gives its hours on every working day in its range, none on a day off", () => {
    const b = booking({ from: "2026-11-18", to: "2026-11-19", hoursPerDay: 4 });
    assert.equal(hoursOn(b, "2026-11-17", false), 0);
    assert.equal(hoursOn(b, "2026-11-18", false), 4);
    assert.equal(hoursOn(b, "2026-11-19", true), 0);
    assert.equal(hoursOn(b, "2026-11-20", false), 0);
  });

  it("adds two bookings on one day and skips days off", () => {
    const held = heldByDay(
      [booking({ hoursPerDay: 4 }), booking({ id: "2", hoursPerDay: 2, from: "2026-11-17", to: "2026-11-17" }), booking({ id: "3", accountId: "b" })],
      "a",
      ["2026-11-16", "2026-11-17", "2026-11-18"],
      (d) => d === "2026-11-18"
    );
    assert.deepEqual([...held], [["2026-11-16", 4], ["2026-11-17", 6]]);
  });

  it("only bookings on other projects are held against this one", () => {
    const list = [booking({ projectKey: "P" }), booking({ id: "2", projectKey: "OTHER" })];
    assert.deepEqual(heldElsewhere(list, "P").map((b) => b.id), ["2"]);
  });
});

describe("rankCandidates with hours held by other projects", () => {
  const free = (id: string) => task({ id: `X-${id}`, summary: "x", assigneeAccountId: null });
  const input = (held: Booking[]) => ({
    tasks: [free("1")],
    users,
    profiles: [profile("a"), profile("b")],
    absences: [],
    heldElsewhere: held,
  });

  it("someone free by tasks but held 8h a day elsewhere ranks after someone really free", () => {
    const ranked = rankCandidates(buildWorkload(input([booking()])), "2026-11-16", "2026-11-18", null);
    assert.deepEqual(ranked.map((c) => c.accountId), ["b", "a"]);
    const a = ranked[1];
    assert.equal(a.conflictDays, 3);
    assert.equal(a.heldConflictDays, 3, "the conflict comes only from bookings");
    assert.equal(a.heldHours, 24);
    assert.equal(a.heldPerDay, 8);
    assert.equal(ranked[0].heldHours, 0);
  });

  it("partial hold: 4h of 8 does not conflict a 4h job, and shrinks the free hours", () => {
    const ranked = rankCandidates(buildWorkload(input([booking({ hoursPerDay: 4 })])), "2026-11-16", "2026-11-18", 4);
    const a = ranked.find((c) => c.accountId === "a")!;
    assert.equal(a.conflictDays, 0);
    assert.equal(a.freeHours, 12);
    assert.equal(a.heldPerDay, 4);
  });

  it("a conflict that tasks already cause is not blamed on the bookings", () => {
    const busy = task({ id: "X-2", summary: "busy", assigneeAccountId: "a", startDate: "2026-11-16", dueDate: "2026-11-18" });
    const w = buildWorkload({ ...input([booking({ hoursPerDay: 4 })]), tasks: [busy] });
    const a = rankCandidates(w, "2026-11-16", "2026-11-18", null).find((c) => c.accountId === "a")!;
    assert.equal(a.conflictDays, 3);
    assert.equal(a.heldConflictDays, 0);
  });

  it("without bookings the ranking is what it always was", () => {
    const ranked = rankCandidates(buildWorkload(input([])), "2026-11-16", "2026-11-18", null);
    assert.deepEqual(ranked.map((c) => c.conflictDays), [0, 0]);
    assert.equal(ranked[0].heldHours, 0);
  });

  it("leave and weekends hold nothing", () => {
    const away: ResourceAbsence = { id: "1", accountId: "a", from: "2026-11-16", to: "2026-11-16", reason: null };
    const w = buildWorkload({ ...input([booking({ to: "2026-11-22" })]), absences: [away] });
    const held = w.get("a")!.held;
    assert.equal(held.has("2026-11-16"), false, "on leave");
    assert.equal(held.has("2026-11-21"), false, "Saturday");
    assert.equal(held.get("2026-11-17"), 8);
  });
});

describe("sprint capacity with hours held elsewhere", () => {
  const members = users.map((u) => ({ accountId: u.accountId, displayName: u.displayName }));

  it("comes off capacity and is reported beside it", () => {
    const [a, b] = availability(members, [], [], "2026-11-16", "2026-11-20", 8, DEFAULT_WORK_CALENDAR, [booking({ hoursPerDay: 4 })]);
    assert.equal(a.capacityHours, 20);
    assert.equal(a.heldHours, 20);
    assert.equal(b.capacityHours, 40);
    assert.equal(b.heldHours, 0);
  });

  it("never goes below zero, and leave is not double-subtracted", () => {
    const away: ResourceAbsence = { id: "1", accountId: "a", from: "2026-11-16", to: "2026-11-17", reason: null };
    const [a] = availability(members, [], [away], "2026-11-16", "2026-11-20", 8, DEFAULT_WORK_CALENDAR, [booking({ hoursPerDay: 12 })]);
    assert.equal(a.days, 3);
    assert.equal(a.heldHours, 36);
    assert.equal(a.capacityHours, 0);
  });

  it("with no bookings it is the old number", () => {
    const [a] = availability(members, [], [], "2026-11-16", "2026-11-20", 8);
    assert.equal(a.capacityHours, 40);
    assert.equal(a.heldHours, 0);
  });
});

describe("bookedWeeks", () => {
  it("cuts weeks at Monday and at the window, and flags a week with an over-booked day", () => {
    const weeks = bookedWeeks({
      bookings: [booking({ hoursPerDay: 6 }), booking({ id: "2", hoursPerDay: 4, from: "2026-11-18", to: "2026-11-18" })],
      capacityHoursPerDay: 8,
      from: "2026-11-14",
      to: "2026-11-24",
      isOff: (d) => ["2026-11-14", "2026-11-15", "2026-11-21", "2026-11-22"].includes(d),
    });
    assert.deepEqual(weeks.map((w) => [w.from, w.to]), [["2026-11-14", "2026-11-15"], ["2026-11-16", "2026-11-22"], ["2026-11-23", "2026-11-24"]]);
    assert.deepEqual(weeks[1], { from: "2026-11-16", to: "2026-11-22", booked: 34, capacity: 40, free: 6, over: true });
    assert.equal(weeks[0].capacity, 0);
    assert.equal(weeks[2].free, 16);
  });
});

describe("the assistant's bookings answer", () => {
  const team: JiraUser[] = [
    ...users,
    { accountId: "me", displayName: "Tuấn", avatarUrl: null },
  ];
  const viewer = (o: Partial<Viewer> = {}): Viewer => ({
    accountId: "me",
    manager: false,
    pmOf: new Set(),
    accessible: new Set(["P"]),
    ...o,
  });
  const all = [
    booking({ id: "1", accountId: "a", projectKey: "P", hoursPerDay: 4, note: "ghi chú của P" }),
    booking({ id: "2", accountId: "a", projectKey: "SECRET", hoursPerDay: 4, note: "chuyện riêng của SECRET" }),
    booking({ id: "3", accountId: "b", projectKey: "P", hoursPerDay: 6 }),
    booking({ id: "4", accountId: "me", projectKey: "P", hoursPerDay: 2 }),
  ];
  const ask = (v: Viewer, person = "") =>
    bookingsAnswer({
      person,
      from: "2026-11-16",
      to: "2026-11-20",
      today: "2026-11-16",
      projectKey: "P",
      team,
      bookings: all,
      viewer: v,
      profiles: [],
      absences: [],
      calendar: DEFAULT_WORK_CALENDAR,
      names: async () => new Map(),
    });
  const names = (r: Record<string, unknown>) => (r.people as Array<{ name: string }>).map((p) => p.name);

  it("a member sees only themselves and is told the rest is hidden, not free", async () => {
    const r = await ask(viewer());
    assert.deepEqual(names(r), ["Tuấn"]);
    assert.equal(r.limited, true);
    assert.match(String(r.note), /không có nghĩa là họ rảnh/);
  });

  it("a member asking about someone else gets a refusal, not an empty list", async () => {
    const r = await ask(viewer(), "An");
    assert.equal(r.error, "Bạn chỉ xem được booking của mình.");
    assert.equal(r.people, undefined);
  });

  it("a project manager sees the team of their project; a hidden project is 'dự án khác' with no key and no note", async () => {
    const r = await ask(viewer({ pmOf: new Set(["P"]) }));
    assert.deepEqual(names(r).sort(), ["An", "Bình", "Tuấn"].sort());
    const an = (r.people as Array<{ name: string; bookings: Array<{ project: string }>; weeks: Array<{ bookedHours: number }> }>).find((p) => p.name === "An")!;
    assert.deepEqual(an.bookings.map((b) => b.project).sort(), ["P", "dự án khác"]);
    assert.equal(an.weeks[0].bookedHours, 40, "the hidden project's hours still count");
    assert.equal(r.limited, undefined);
    const text = JSON.stringify(r);
    assert.ok(!text.includes("SECRET"), "the key never reaches the model");
    assert.ok(!text.includes("chuyện riêng"), "nor the note");
  });

  it("a resource manager sees everyone, still without the names of projects they cannot browse", async () => {
    const r = await ask(viewer({ manager: true }));
    assert.deepEqual(names(r).sort(), ["An", "Bình", "Tuấn"].sort());
    assert.ok(!JSON.stringify(r).includes("SECRET"));
  });

  it("says how much is free and which weeks are over", async () => {
    const r = await ask(viewer({ pmOf: new Set(["P"]) }), "Bình");
    const [b] = r.people as Array<{ freeHours: number; overWeeks: number }>;
    assert.equal(b.freeHours, 10);
    assert.equal(b.overWeeks, 0);
  });

  it("an unknown name is an error that names nobody it should not", async () => {
    const r = await ask(viewer({ manager: true }), "Không ai cả");
    assert.ok("error" in r);
  });
});
