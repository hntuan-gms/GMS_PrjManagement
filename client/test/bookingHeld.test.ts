import assert from "node:assert/strict";
import { describe, it } from "node:test";
// The server's rule is a mirror of the client's (see the header of both files); running the same cases over
// the two keeps the assistant's "who is free" and the picker's hints from disagreeing about a held day.
import * as server from "../../server/src/bookingLoad";
import { assignHints, describeHint } from "../src/assignHints";
import { bookingBadge, bookingGap, bookingWindow, heldElsewhereByDay, hoursOn } from "../src/bookingModel";
import { capacityRows } from "../src/boardModel";
import { projectPulseDecisionsForTest } from "./pulseFixture";
import { addDays, buildResourceLoad } from "../src/resourceAllocation";
import { mergeRemote, remoteAsTask } from "../src/taskPickerModel";
import type { Booking, BookingPerson, JiraUser, ResourceAbsence } from "../src/types";
import { toWorkCalendar } from "../src/workCalendar";
import { task } from "./fixtures";

// 2026-11-16 is a Monday.
const MON = "2026-11-16";
const booking = (o: Partial<Booking> = {}): Booking => ({
  id: "1",
  accountId: "an",
  projectKey: "OTHER",
  from: MON,
  to: "2026-11-20",
  hoursPerDay: 8,
  status: "confirmed",
  note: null,
  editable: false,
  ...o,
});
const user = (accountId: string, displayName: string): JiraUser => ({ accountId, displayName, avatarUrl: null });
const people = [user("an", "An"), user("binh", "Bình")];
const cal = toWorkCalendar(null);

describe("hoursOn: client and server agree", () => {
  const cases: Array<[Partial<Booking>, string, boolean, number]> = [
    [{ hoursPerDay: 4 }, "2026-11-15", false, 0],
    [{ hoursPerDay: 4 }, "2026-11-16", false, 4],
    [{ hoursPerDay: 4 }, "2026-11-20", false, 4],
    [{ hoursPerDay: 4 }, "2026-11-21", false, 0],
    [{ hoursPerDay: 4 }, "2026-11-17", true, 0],
    [{ hoursPerDay: 2.5, status: "tentative" }, "2026-11-18", false, 2.5],
  ];
  for (const [o, date, off, want] of cases) {
    it(`${date}${off ? " (off)" : ""} → ${want}`, () => {
      const b = booking(o);
      assert.equal(hoursOn(b, { date, off: off ? "away" : null }), want, "client");
      assert.equal(server.hoursOn(b, date, off), want, "server");
    });
  }
});

describe("heldElsewhereByDay", () => {
  const input = { absences: [] as ResourceAbsence[], projectKey: "P", from: MON, to: "2026-11-29", calendar: cal };

  it("holds hours of other projects, and of an unnamed one, but never of this project", () => {
    const held = heldElsewhereByDay({
      ...input,
      bookings: [booking({ projectKey: "P", hoursPerDay: 6 }), booking({ id: "2", projectKey: "Q", hoursPerDay: 3 }), booking({ id: "3", projectKey: null, hoursPerDay: 2 })],
    });
    assert.equal(held.get("an")?.get("2026-11-17"), 5);
  });

  it("skips weekends and leave, and is cut to the window", () => {
    const held = heldElsewhereByDay({
      ...input,
      to: "2026-11-18",
      absences: [{ accountId: "an", from: "2026-11-17", to: "2026-11-17" }],
      bookings: [booking({ to: "2026-11-24" })],
    });
    const days = held.get("an")!;
    assert.deepEqual([...days.keys()], ["2026-11-16", "2026-11-18"]);
  });

  it("matches the server's per-day figures for the same bookings", () => {
    const b = [booking({ hoursPerDay: 4 }), booking({ id: "2", projectKey: "Q", from: "2026-11-18", to: "2026-11-19", hoursPerDay: 2 })];
    const client = heldElsewhereByDay({ ...input, bookings: b }).get("an")!;
    const dates = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"];
    const srv = server.heldByDay(b, "an", dates, (d) => d === "2026-11-21");
    assert.deepEqual([...client], [...srv]);
  });
});

describe("assignHints with hours other projects hold", () => {
  const asked = task({ id: "N-1", summary: "việc mới", startDate: "2026-11-16", dueDate: "2026-11-18", durationDays: 3 });
  const load = buildResourceLoad({ tasks: [], users: people, profiles: [], absences: [], from: MON, to: "2026-11-22", includeIdle: true, calendar: cal });
  const held = heldElsewhereByDay({ bookings: [booking()], absences: [], projectKey: "P", from: MON, to: "2026-11-22", calendar: cal });

  it("someone free by tasks but held 8h a day elsewhere ranks after someone really free", () => {
    const h = assignHints(asked, people, load, cal, held);
    assert.deepEqual(h.map((x) => x.accountId), ["binh", "an"]);
    const an = h[1];
    assert.equal(an.conflictDays, 3);
    assert.equal(an.heldConflictDays, 3);
    assert.equal(an.heldPerDay, 8);
  });

  it("without the held hours the order is by name, as before", () => {
    assert.deepEqual(assignHints(asked, people, load, cal).map((x) => x.accountId), ["an", "binh"]);
  });

  it("says where the conflict comes from, beside the days when tasks also cause it", () => {
    const [only] = assignHints(asked, people, load, cal, held).slice(1);
    assert.deepEqual(describeHint(only), { text: "bị giữ 8h/ngày", tone: "risk" });
    const mixed = { ...only, conflictDays: 3, heldConflictDays: 1, heldPerDay: 4 };
    assert.deepEqual(describeHint(mixed), { text: "trùng 3 ngày · bị giữ 4h/ngày", tone: "risk" });
    assert.deepEqual(describeHint({ ...mixed, heldConflictDays: 0, heldPerDay: 0 }), { text: "trùng 3 ngày", tone: "risk" });
  });
});

describe("bookingGap / bookingBadge / bookingWindow", () => {
  const soon = { from: MON, to: addDays(MON, 13) };
  const tasks = [task({ id: "A-1", summary: "a", startDate: MON, dueDate: "2026-11-20", assigneeAccountId: "an", assigneeName: "An" })];
  const load = buildResourceLoad({ tasks, users: people, profiles: [], absences: [], from: soon.from, to: soon.to, calendar: cal });
  const person = load.people.find((p) => p.accountId === "an");

  it("assigned more than booked is a gap, equal is not, and the threshold is the caller's", () => {
    const base = { person, absences: [], accountId: "an", projectKey: "P", soon, calendar: cal };
    assert.deepEqual(bookingGap({ ...base, bookings: [booking({ projectKey: "P", hoursPerDay: 2 })] }), { assigned: 40, booked: 10 });
    assert.equal(bookingGap({ ...base, bookings: [booking({ projectKey: "P", hoursPerDay: 8 })] }), null);
    assert.equal(bookingGap({ ...base, bookings: [booking({ projectKey: "P", hoursPerDay: 2 })], minGap: 30 }), null);
    assert.equal(bookingGap({ ...base, person: undefined, bookings: [] }), null);
  });

  it("the badge counts people over capacity by bookings, and is null when the project has none", () => {
    const people2: BookingPerson[] = [{ ...people[0], capacityHoursPerDay: 8, role: null, skills: [] }];
    const sheet = { people: people2, absences: [], bookings: [booking({ projectKey: "P", hoursPerDay: 10 })] };
    assert.equal(bookingBadge(sheet, "P", soon, cal), 1);
    assert.equal(bookingBadge({ ...sheet, bookings: [booking({ projectKey: "P", hoursPerDay: 4 })] }, "P", soon, cal), 0);
    assert.equal(bookingBadge({ ...sheet, bookings: [booking({ projectKey: "OTHER", hoursPerDay: 10 })] }, "P", soon, cal), null);
    assert.equal(bookingBadge({ ...sheet, bookings: [booking({ projectKey: "P", from: "2027-03-01", to: "2027-03-05" })] }, "P", soon, cal), null);
  });

  it("the window starts on a Monday, three weeks back, and is 39 weeks long", () => {
    const { from, to } = bookingWindow("2026-11-18");
    assert.equal(from, "2026-10-26");
    assert.equal(to, addDays(from, 39 * 7 - 1));
    assert.equal(bookingWindow("2026-11-18", 1).from, "2026-11-02");
  });
});

describe("Nhịp dự án: assigned past booked", () => {
  it("names the person with the biggest gap, offers Book thêm last, and is silent without a booking on the project", () => {
    const { withBooking, withoutBooking, otherProjectOnly } = projectPulseDecisionsForTest();
    const row = withBooking.find((d) => d.kind === "booking-gap");
    assert.ok(row, "a row");
    assert.match(row!.title, /An/);
    assert.match(row!.body, /40h/);
    assert.deepEqual(row!.actions.map((a) => a.kind), ["rebalance", "book"]);
    assert.equal(withoutBooking.some((d) => d.kind === "booking-gap"), false);
    assert.equal(otherProjectOnly.some((d) => d.kind === "booking-gap"), false);
  });
});

describe("sprint capacity rows carry what other projects hold", () => {
  it("heldHours passes through, 0 when the answer predates it", () => {
    const rows = capacityRows(
      [
        { accountId: "an", name: "An", days: 5, hoursPerDay: 8, capacityHours: 20, heldHours: 20 },
        { accountId: "binh", name: "Bình", days: 5, hoursPerDay: 8, capacityHours: 40 },
      ],
      [],
      { estimation: null } as never
    );
    assert.deepEqual(rows.map((r) => [r.name, r.heldHours]).sort(), [["An", 20], ["Bình", 0]]);
  });
});

describe("picking an issue from another project", () => {
  it("lists what was found after the plan's own rows, never twice, never an excluded one", () => {
    const local = [task({ id: "P-1", summary: "có sẵn" })];
    const found = [
      { key: "P-1", summary: "đã có", issueType: "Task" },
      { key: "Q-5", summary: "việc bên Q", issueType: "Bug", inProgress: true },
      { key: "Q-6", summary: "đã trên bảng", issueType: "Task" },
    ];
    const out = mergeRemote(local, found, ["Q-6"]);
    assert.deepEqual(out.map((t) => t.id), ["Q-5"]);
    assert.equal(out[0].statusCategory, "indeterminate");
    assert.equal(remoteAsTask(found[2]).statusCategory, "new");
  });
});
