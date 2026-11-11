import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OTHER,
  axisDays,
  bookDays,
  bookedCounts,
  bookedHours,
  buildBooked,
  dayAtPx,
  dragRange,
  draftsFromLoad,
  filterBooked,
  fmtBookingHours,
  isOffBooking,
  packLanes,
  parseBookingHours,
  rowsOf,
  spanPx,
  sumIn,
  weekCells,
  weekStart,
} from "../src/bookingModel";
import type { DayLoad } from "../src/resourceAllocation";
import type { Booking, BookingPerson } from "../src/types";
import { toWorkCalendar } from "../src/workCalendar";

// 2026-11-09 is a Monday.
const MON = "2026-11-09";
const SUN = "2026-11-15";

const booking = (o: Partial<Booking> = {}): Booking => ({
  id: "1",
  accountId: "quang",
  projectKey: "GPM",
  from: MON,
  to: "2026-11-13",
  hoursPerDay: 4,
  status: "confirmed",
  note: null,
  editable: true,
  ...o,
});

const person = (o: Partial<BookingPerson> = {}): BookingPerson => ({
  accountId: "quang",
  displayName: "Quang",
  avatarUrl: null,
  capacityHoursPerDay: 8,
  role: null,
  skills: [],
  ...o,
});

describe("bookDays", () => {
  it("gives a booking its hours on working days only", () => {
    const days = bookDays({ capacityHoursPerDay: 8, bookings: [booking({ to: SUN })], absences: [], from: MON, to: SUN });
    assert.deepEqual(days.map((d) => d.booked), [4, 4, 4, 4, 4, 0, 0]);
    assert.deepEqual(days.map((d) => d.capacity), [8, 8, 8, 8, 8, 0, 0]);
    assert.equal(days[5].off, "weekend");
  });

  it("adds bookings up across projects and keeps the tentative part apart", () => {
    const days = bookDays({
      capacityHoursPerDay: 8,
      bookings: [booking(), booking({ id: "2", projectKey: "AI", hoursPerDay: 6, status: "tentative" })],
      absences: [],
      from: MON,
      to: MON,
    });
    assert.equal(days[0].booked, 10);
    assert.equal(days[0].tentative, 6);
  });

  it("books nothing on leave or on a holiday, and a make-up Saturday is worked", () => {
    const calendar = toWorkCalendar({ workDays: [1, 2, 3, 4, 5], holidays: [{ date: "2026-11-10", name: "Lễ" }], makeUpDays: [{ date: "2026-11-14", name: "Bù" }] });
    const days = bookDays({
      capacityHoursPerDay: 8,
      bookings: [booking({ to: SUN })],
      absences: [{ from: "2026-11-11", to: "2026-11-11" }],
      from: MON,
      to: SUN,
      calendar,
    });
    assert.deepEqual(days.map((d) => d.booked), [4, 0, 0, 4, 4, 4, 0]);
    assert.deepEqual(days.map((d) => d.off), [null, "holiday", "away", null, null, null, "weekend"]);
  });
});

describe("weekCells", () => {
  it("cuts at Mondays and the window's ends", () => {
    const days = bookDays({ capacityHoursPerDay: 8, bookings: [booking()], absences: [], from: "2026-11-11", to: "2026-11-17" });
    const cells = weekCells(days);
    assert.deepEqual(cells.map((c) => [c.start, c.end]), [["2026-11-11", "2026-11-15"], ["2026-11-16", "2026-11-17"]]);
    assert.equal(cells[0].booked, 12);
    assert.equal(cells[0].capacity, 24);
    assert.equal(cells[0].band, "healthy");
    assert.equal(cells[1].band, "free");
  });

  it("is over when one day is, even if the week averages under 100%", () => {
    const days = bookDays({
      capacityHoursPerDay: 8,
      bookings: [booking({ from: MON, to: MON, hoursPerDay: 12 })],
      absences: [],
      from: MON,
      to: SUN,
    });
    const [cell] = weekCells(days);
    assert.equal(cell.ratio < 1, true);
    assert.equal(cell.band, "over");
  });

  it("is off when nobody works that stretch", () => {
    const days = bookDays({ capacityHoursPerDay: 8, bookings: [], absences: [{ from: MON, to: SUN }], from: MON, to: SUN });
    assert.equal(weekCells(days)[0].band, "off");
  });

  it("finds the Monday of any day", () => {
    assert.equal(weekStart("2026-11-15"), MON);
    assert.equal(weekStart(MON), MON);
  });
});

describe("rows", () => {
  it("stacks overlapping bookings on separate lanes and reuses a lane once it is free", () => {
    const { lanes, laneCount } = packLanes([
      booking({ id: "a", from: "2026-11-09", to: "2026-11-13" }),
      booking({ id: "b", from: "2026-11-11", to: "2026-11-20" }),
      booking({ id: "c", from: "2026-11-16", to: "2026-11-18" }),
    ]);
    assert.equal(laneCount, 2);
    assert.deepEqual([lanes.get("a"), lanes.get("b"), lanes.get("c")], [0, 1, 0]);
  });

  it("puts the viewed project first even when empty, and unnamed projects last as one row", () => {
    const rows = rowsOf(
      [booking({ id: "1", projectKey: "AI" }), booking({ id: "2", projectKey: null }), booking({ id: "3", projectKey: null }), booking({ id: "4", accountId: "minh" })],
      "quang",
      "GPM"
    );
    assert.deepEqual(rows.map((r) => r.key), ["GPM", "AI", OTHER]);
    assert.equal(rows[0].bookings.length, 0);
    assert.equal(rows[2].bookings.length, 2);
  });
});

describe("people", () => {
  const soon = { from: MON, to: "2026-11-22" };
  const people = [person(), person({ accountId: "minh", displayName: "Minh", role: "Kiểm thử", skills: ["Selenium"] }), person({ accountId: "lan", displayName: "Lan" })];
  const built = buildBooked({
    people,
    bookings: [booking({ hoursPerDay: 10 }), booking({ id: "2", accountId: "minh", from: MON, to: "2026-11-20", hoursPerDay: 8 })],
    absences: [],
    from: MON,
    to: "2026-12-06",
    soon,
  });

  it("counts who is over and who has room in the two weeks ahead", () => {
    assert.deepEqual(bookedCounts(built), { all: 3, over: 1, free: 2 });
  });

  it("filters by over, by free, and by text without diacritics, with me first", () => {
    assert.deepEqual(filterBooked(built, "", "over", "lan").map((p) => p.person.accountId), ["quang"]);
    assert.deepEqual(filterBooked(built, "", "free", "lan").map((p) => p.person.accountId), ["lan", "quang"]);
    assert.deepEqual(filterBooked(built, "kiem thu", "all", "x").map((p) => p.person.accountId), ["minh"]);
    assert.deepEqual(filterBooked(built, "selen", "all", "x").map((p) => p.person.accountId), ["minh"]);
    assert.equal(filterBooked(built, "", "all", "lan")[0].person.accountId, "lan");
  });

  it("sums a window", () => {
    assert.deepEqual(sumIn(built[0].days, MON, SUN), { booked: 50, capacity: 40, overDays: 5 });
  });
});

describe("typing hours", () => {
  it("reads hours, a comma, and a share of the person's day", () => {
    assert.equal(parseBookingHours("4", 8), 4);
    assert.equal(parseBookingHours("4h", 8), 4);
    assert.equal(parseBookingHours("4,5", 8), 4.5);
    assert.equal(parseBookingHours("50%", 8), 4);
    assert.equal(parseBookingHours("50 %", 6), 3);
    assert.equal(parseBookingHours("100%", 8), 8);
  });

  it("refuses what is not a day's hours", () => {
    for (const t of ["", "0", "abc", "17", "-2", "300%", "0%"]) assert.equal(parseBookingHours(t, 8), null, t);
  });

  it("writes hours the way they are typed here", () => {
    assert.equal(fmtBookingHours(4.5), "4,5h");
    assert.equal(fmtBookingHours(8), "8h");
  });
});

describe("bookings out of the work already assigned", () => {
  const day = (date: string, allocatedHours: number): DayLoad => ({
    date,
    capacityHours: 8,
    allocatedHours,
    ratio: allocatedHours / 8,
    band: "healthy",
    taskIds: [],
    offReason: null,
  });
  const week = (monday: string, hours: number) => [0, 1, 2, 3, 4].map((i) => day(new Date(Date.parse(monday) + i * 86_400_000).toISOString().slice(0, 10), hours));

  it("joins weeks that touch at the same hours and rounds up to half an hour", () => {
    const drafts = draftsFromLoad([{ accountId: "quang", days: [...week("2026-11-09", 3.2), ...week("2026-11-16", 3.2), ...week("2026-11-30", 3.2)] }], [], "GPM");
    assert.deepEqual(drafts, [
      { accountId: "quang", from: "2026-11-09", to: "2026-11-20", hoursPerDay: 3.5 },
      { accountId: "quang", from: "2026-11-30", to: "2026-12-04", hoursPerDay: 3.5 },
    ]);
  });

  it("starts a new booking when the hours change", () => {
    const drafts = draftsFromLoad([{ accountId: "quang", days: [...week("2026-11-09", 4), ...week("2026-11-16", 8)] }], [], "GPM");
    assert.equal(drafts.length, 2);
  });

  it("proposes nothing where this project has already booked the person", () => {
    const drafts = draftsFromLoad([{ accountId: "quang", days: week("2026-11-09", 4) }], [booking()], "GPM");
    assert.deepEqual(drafts, []);
    // A booking on another project does not count.
    assert.equal(draftsFromLoad([{ accountId: "quang", days: week("2026-11-09", 4) }], [booking({ projectKey: "AI" })], "GPM").length, 1);
  });

  it("skips days with nothing assigned", () => {
    assert.deepEqual(draftsFromLoad([{ accountId: "quang", days: week("2026-11-09", 0) }], [], "GPM"), []);
  });
});

describe("beside the hours logged", () => {
  const days = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];

  it("totals a week per project, leave taken out", () => {
    const out = bookedHours({
      bookings: [booking(), booking({ id: "2", projectKey: "AI", hoursPerDay: 2 }), booking({ id: "3", projectKey: null, hoursPerDay: 1 }), booking({ id: "4", accountId: "minh" })],
      accountId: "quang",
      days,
      absences: [{ from: "2026-11-13", to: "2026-11-13" }],
    });
    assert.equal(out.total, 28);
    assert.deepEqual([...out.byProject], [["GPM", 16], ["AI", 8], [OTHER, 4]]);
  });

  it("flags a gap of more than a fifth, and at least an hour", () => {
    assert.equal(isOffBooking(25, 40), true);
    assert.equal(isOffBooking(36, 40), false);
    assert.equal(isOffBooking(50, 40), true);
    assert.equal(isOffBooking(1.5, 2), false);
    assert.equal(isOffBooking(10, 0), false);
  });
});

describe("the axis", () => {
  const axis = { from: MON, to: "2026-11-22", pxPerDay: 20 };

  it("places a span and says when it is cut", () => {
    assert.equal(axisDays(axis), 14);
    assert.deepEqual(spanPx(axis, "2026-11-10", "2026-11-12"), { left: 20, width: 60, cutLeft: false, cutRight: false });
    assert.deepEqual(spanPx(axis, "2026-11-01", "2026-11-30"), { left: 0, width: 280, cutLeft: true, cutRight: true });
    assert.equal(spanPx(axis, "2026-12-01", "2026-12-05"), null);
  });

  it("finds the day under a pixel, clamped", () => {
    assert.equal(dayAtPx(axis, 0), MON);
    assert.equal(dayAtPx(axis, 39), "2026-11-10");
    assert.equal(dayAtPx(axis, -50), MON);
    assert.equal(dayAtPx(axis, 9999), "2026-11-22");
  });

  it("moves a bar, or one edge never past the other", () => {
    const b = { from: "2026-11-10", to: "2026-11-12" };
    assert.deepEqual(dragRange(b, "move", 3), { from: "2026-11-13", to: "2026-11-15" });
    assert.deepEqual(dragRange(b, "start", 5), { from: "2026-11-12", to: "2026-11-12" });
    assert.deepEqual(dragRange(b, "end", -9), { from: "2026-11-10", to: "2026-11-10" });
    assert.deepEqual(dragRange(b, "end", 2), { from: "2026-11-10", to: "2026-11-14" });
  });
});
