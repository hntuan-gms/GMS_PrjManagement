import { addDays, eachDate, ratioBand } from "./resourceAllocation";
import type { DayLoad, PersonLoad } from "./resourceAllocation";
import type { Booking, BookingPerson, ResourceAbsence } from "./types";
import { DEFAULT_WORK_CALENDAR, dayKind, isoWeekday, type WorkCalendar } from "./workCalendar";

/*
 * Booking, worked out away from React (client/test/bookingModel.test.ts).
 *
 * Three layers per person per day: what they have (capacity), what was promised (bookings) and, elsewhere,
 * what was done (worklogs). This file owns the middle one. One rule decides a day: a booking gives its
 * hours on every day of its range that the project works and the person is not on leave. Nothing is
 * refused for being over capacity; it is shown.
 *
 * One working calendar is used for every project in a view (the one of the project the tab is on):
 * a holiday entered on project A does not empty project B's booking in A's own view, but each view is
 * consistent with itself.
 */

export interface BookDay {
  date: string;
  /** 0 on a day off or on leave. */
  capacity: number;
  booked: number;
  /** The part of `booked` that is still tentative. */
  tentative: number;
  off: "weekend" | "holiday" | "away" | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function isAwayOn(absences: readonly Pick<ResourceAbsence, "from" | "to">[], date: string): boolean {
  return absences.some((a) => a.from <= date && date <= a.to);
}

/** The hours one booking claims on one day. */
export function hoursOn(b: Pick<Booking, "from" | "to" | "hoursPerDay">, day: Pick<BookDay, "date" | "off">): number {
  return day.off === null && b.from <= day.date && day.date <= b.to ? b.hoursPerDay : 0;
}

/** One person's days in a window: capacity, and what the bookings given claim of it. */
export function bookDays(input: {
  capacityHoursPerDay: number;
  bookings: readonly Booking[];
  absences: readonly Pick<ResourceAbsence, "from" | "to">[];
  from: string;
  to: string;
  calendar?: WorkCalendar;
}): BookDay[] {
  const cal = input.calendar ?? DEFAULT_WORK_CALENDAR;
  return eachDate(input.from, input.to).map((date) => {
    const kind = dayKind(date, cal);
    const off: BookDay["off"] = kind !== "work" ? kind : isAwayOn(input.absences, date) ? "away" : null;
    const day: BookDay = { date, capacity: off ? 0 : input.capacityHoursPerDay, booked: 0, tentative: 0, off };
    for (const b of input.bookings) {
      const h = hoursOn(b, day);
      day.booked += h;
      if (b.status === "tentative") day.tentative += h;
    }
    day.booked = round2(day.booked);
    day.tentative = round2(day.tentative);
    return day;
  });
}

export type BookBand = "free" | "light" | "healthy" | "over" | "off";

export interface BookCell {
  start: string;
  end: string;
  booked: number;
  capacity: number;
  /** booked / capacity; 0 when there is no capacity. */
  ratio: number;
  band: BookBand;
  /** At least one day in the cell is over its capacity (a week can average under 100% and still hide one). */
  overDay: boolean;
}

function cellOf(days: readonly BookDay[]): BookCell {
  const booked = round2(days.reduce((s, d) => s + d.booked, 0));
  const capacity = round2(days.reduce((s, d) => s + d.capacity, 0));
  const ratio = capacity > 0 ? booked / capacity : 0;
  const overDay = days.some((d) => d.capacity > 0 && d.booked > d.capacity + 1e-6);
  const band: BookBand = capacity <= 0 ? "off" : booked <= 0 ? "free" : overDay ? "over" : ratioBand(ratio);
  return { start: days[0].date, end: days[days.length - 1].date, booked, capacity, ratio, band, overDay };
}

/** Monday of the week a date is in. */
export function weekStart(iso: string): string {
  return addDays(iso, 1 - isoWeekday(iso));
}

/** Weeks (Monday to Sunday), cut at the window's ends. */
export function weekCells(days: readonly BookDay[]): BookCell[] {
  const out: BookCell[] = [];
  let run: BookDay[] = [];
  for (const d of days) {
    if (run.length > 0 && isoWeekday(d.date) === 1) {
      out.push(cellOf(run));
      run = [];
    }
    run.push(d);
  }
  if (run.length > 0) out.push(cellOf(run));
  return out;
}

export function sumIn(days: readonly BookDay[], from: string, to: string): { booked: number; capacity: number; overDays: number } {
  let booked = 0;
  let capacity = 0;
  let overDays = 0;
  for (const d of days) {
    if (d.date < from || d.date > to) continue;
    booked += d.booked;
    capacity += d.capacity;
    if (d.capacity > 0 && d.booked > d.capacity + 1e-6) overDays++;
  }
  return { booked: round2(booked), capacity: round2(capacity), overDays };
}

// ---------------------------------------------------------------------------------------------------------------
// Rows

/** The rows one person opens into: one per project, the unnamed ones folded into a single "other" row. */
export interface BookingRow {
  /** A project key, or OTHER for projects this viewer cannot browse. */
  key: string;
  bookings: Booking[];
  /** Which sub-line each booking is drawn on, so two overlapping ones do not cover each other. */
  lanes: Map<string, number>;
  laneCount: number;
}

export const OTHER = "__other__";

export function packLanes(bookings: readonly Booking[]): { lanes: Map<string, number>; laneCount: number } {
  const lanes = new Map<string, number>();
  const ends: string[] = [];
  for (const b of [...bookings].sort((a, c) => a.from.localeCompare(c.from) || a.to.localeCompare(c.to) || a.id.localeCompare(c.id))) {
    let lane = ends.findIndex((end) => end < b.from);
    if (lane < 0) lane = ends.length;
    ends[lane] = b.to;
    lanes.set(b.id, lane);
  }
  return { lanes, laneCount: Math.max(1, ends.length) };
}

/**
 * `first` (the project the view is about, when there is one) leads even with nothing booked, so there is a
 * line to book on; then the named projects by key; "other" last.
 */
export function rowsOf(bookings: readonly Booking[], accountId: string, first: string | null = null): BookingRow[] {
  const byKey = new Map<string, Booking[]>();
  if (first) byKey.set(first, []);
  for (const b of bookings) {
    if (b.accountId !== accountId) continue;
    const key = b.projectKey ?? OTHER;
    const list = byKey.get(key) ?? [];
    list.push(b);
    byKey.set(key, list);
  }
  const order = (k: string) => (k === first ? 0 : k === OTHER ? 2 : 1);
  return [...byKey.keys()]
    .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
    .map((key) => ({ key, bookings: byKey.get(key)!, ...packLanes(byKey.get(key)!) }));
}

// ---------------------------------------------------------------------------------------------------------------
// People

export interface BookedPerson {
  person: BookingPerson;
  days: BookDay[];
  /** In the two weeks ahead (the same window as the Resource lens's badge). */
  soon: { booked: number; capacity: number; overDays: number };
}

export function buildBooked(input: {
  people: readonly BookingPerson[];
  bookings: readonly Booking[];
  absences: readonly ResourceAbsence[];
  from: string;
  to: string;
  soon: { from: string; to: string };
  calendar?: WorkCalendar;
}): BookedPerson[] {
  return input.people.map((person) => {
    const days = bookDays({
      capacityHoursPerDay: person.capacityHoursPerDay,
      bookings: input.bookings.filter((b) => b.accountId === person.accountId),
      absences: input.absences.filter((a) => a.accountId === person.accountId),
      from: input.from,
      to: input.to,
      calendar: input.calendar,
    });
    return { person, days, soon: sumIn(days, input.soon.from, input.soon.to) };
  });
}

export type BookedFilter = "all" | "over" | "free";

export const isOverSoon = (p: BookedPerson) => p.soon.overDays > 0;
/** Has at least a day's worth of unbooked hours in the two weeks ahead. */
export const isFreeSoon = (p: BookedPerson) => p.soon.capacity - p.soon.booked >= p.person.capacityHoursPerDay && p.soon.capacity > 0;

export function bookedCounts(people: readonly BookedPerson[]): { all: number; over: number; free: number } {
  return { all: people.length, over: people.filter(isOverSoon).length, free: people.filter(isFreeSoon).length };
}

const foldText = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();

/** Name, role or a skill, without diacritics. `me` leads the list; the rest stay in name order. */
export function filterBooked(people: readonly BookedPerson[], text: string, mode: BookedFilter, me: string): BookedPerson[] {
  const q = foldText(text.trim());
  return people
    .filter((p) => (mode === "over" ? isOverSoon(p) : mode === "free" ? isFreeSoon(p) : true))
    .filter((p) => !q || foldText([p.person.displayName, p.person.role ?? "", ...p.person.skills].join(" ")).includes(q))
    .sort((a, b) => Number(b.person.accountId === me) - Number(a.person.accountId === me));
}

// ---------------------------------------------------------------------------------------------------------------
// Typing hours

/** "4", "4h", "4,5", "50%" (of this person's day) → hours a day, or null when it is not one. */
export function parseBookingHours(text: string, capacityHoursPerDay: number): number | null {
  const t = text.trim().toLowerCase().replace(",", ".");
  if (!t) return null;
  const pct = /^(\d+(?:\.\d+)?)\s*%$/.exec(t);
  const hrs = /^(\d+(?:\.\d+)?)\s*(?:h|g|giờ|gio)?$/.exec(t);
  const raw = pct ? (Number(pct[1]) / 100) * capacityHoursPerDay : hrs ? Number(hrs[1]) : NaN;
  if (!Number.isFinite(raw) || raw <= 0 || raw > 16) return null;
  return Math.max(0.25, Math.round(raw * 4) / 4);
}

export function fmtBookingHours(h: number): string {
  return `${String(round2(h)).replace(".", ",")}h`;
}

// ---------------------------------------------------------------------------------------------------------------
// The first day: bookings out of the work already assigned

export interface BookingDraft {
  accountId: string;
  from: string;
  to: string;
  hoursPerDay: number;
}

/**
 * Proposes bookings from a project's load (resourceAllocation.buildResourceLoad): for each person, each
 * week in which tasks claim their time and nothing is booked on this project yet becomes one booking,
 * Monday to Friday of that week cut to the days with work, at the week's average hours a day rounded up to
 * half an hour. Weeks next to each other at the same hours join into one. Running it twice proposes nothing
 * the second time.
 */
export function draftsFromLoad(people: readonly Pick<PersonLoad, "accountId" | "days">[], existing: readonly Booking[], projectKey: string): BookingDraft[] {
  const out: BookingDraft[] = [];
  for (const p of people) {
    const mine = existing.filter((b) => b.accountId === p.accountId && b.projectKey === projectKey);
    const weeks = new Map<string, DayLoad[]>();
    for (const d of p.days) {
      if (d.allocatedHours <= 0 || d.capacityHours <= 0) continue;
      const w = weekStart(d.date);
      weeks.set(w, [...(weeks.get(w) ?? []), d]);
    }
    let run: BookingDraft | null = null;
    for (const w of [...weeks.keys()].sort()) {
      const days = weeks.get(w)!;
      const from = days[0].date;
      const to = days[days.length - 1].date;
      if (mine.some((b) => b.from <= to && b.to >= from)) {
        run = null;
        continue;
      }
      const avg = days.reduce((s, d) => s + d.allocatedHours, 0) / days.length;
      const hoursPerDay = Math.min(16, Math.max(0.5, Math.ceil(avg * 2) / 2));
      // Joined only when the weeks touch (this one starts the Monday after the last one's week).
      if (run && run.hoursPerDay === hoursPerDay && weekStart(run.to) === addDays(w, -7)) {
        run.to = to;
      } else {
        run = { accountId: p.accountId, from, to, hoursPerDay };
        out.push(run);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Beside the hours logged (Clockwork)

/**
 * Hours booked for one person in a list of days, in total and per project. An unnamed project counts in the
 * total under OTHER.
 */
export function bookedHours(input: {
  bookings: readonly Booking[];
  accountId: string;
  days: readonly string[];
  absences: readonly Pick<ResourceAbsence, "from" | "to">[];
  calendar?: WorkCalendar;
}): { total: number; byProject: Map<string, number> } {
  const cal = input.calendar ?? DEFAULT_WORK_CALENDAR;
  const byProject = new Map<string, number>();
  let total = 0;
  const working = input.days.filter((d) => dayKind(d, cal) === "work" && !isAwayOn(input.absences, d));
  for (const b of input.bookings) {
    if (b.accountId !== input.accountId) continue;
    const n = working.filter((d) => b.from <= d && d <= b.to).length;
    if (n === 0) continue;
    const h = n * b.hoursPerDay;
    const key = b.projectKey ?? OTHER;
    byProject.set(key, round2((byProject.get(key) ?? 0) + h));
    total += h;
  }
  return { total: round2(total), byProject };
}

/** Logged against booked: off by more than a fifth of the booking (and by at least an hour) is worth a look. */
export function isOffBooking(logged: number, booked: number): boolean {
  if (booked <= 0) return false;
  const gap = Math.abs(logged - booked);
  return gap >= 1 && gap / booked > 0.2;
}

// ---------------------------------------------------------------------------------------------------------------
// The time axis: linear, one width per day

export interface Axis {
  from: string;
  to: string;
  pxPerDay: number;
}

const DAY_MS = 86_400_000;
const dayIndex = (from: string, iso: string) => Math.round((Date.parse(iso) - Date.parse(from)) / DAY_MS);

export function axisDays(a: Axis): number {
  return dayIndex(a.from, a.to) + 1;
}

/** Left edge and width in px of the days [from, to], cut to the axis. null when wholly outside. */
export function spanPx(a: Axis, from: string, to: string): { left: number; width: number; cutLeft: boolean; cutRight: boolean } | null {
  if (to < a.from || from > a.to) return null;
  const s = Math.max(0, dayIndex(a.from, from));
  const e = Math.min(axisDays(a) - 1, dayIndex(a.from, to));
  return { left: s * a.pxPerDay, width: (e - s + 1) * a.pxPerDay, cutLeft: from < a.from, cutRight: to > a.to };
}

/** The day under a pixel, clamped to the axis. */
export function dayAtPx(a: Axis, x: number): string {
  const i = Math.max(0, Math.min(axisDays(a) - 1, Math.floor(x / a.pxPerDay)));
  return addDays(a.from, i);
}

/** A bar dragged: by its body (both ends move) or by one edge (that end moves, never past the other). */
export function dragRange(
  b: Pick<Booking, "from" | "to">,
  mode: "move" | "start" | "end",
  deltaDays: number
): { from: string; to: string } {
  if (mode === "move") return { from: addDays(b.from, deltaDays), to: addDays(b.to, deltaDays) };
  if (mode === "start") {
    const from = addDays(b.from, deltaDays);
    return { from: from > b.to ? b.to : from, to: b.to };
  }
  const to = addDays(b.to, deltaDays);
  return { from: b.from, to: to < b.from ? b.from : to };
}

// ---------------------------------------------------------------------------------------------------------------
// The window every booking read uses

/** Nine months: a few weeks behind today, the rest ahead. */
export const BOOKING_WEEKS = 39;
export const BOOKING_WEEKS_BEHIND = 3;

/**
 * The window the Booking view reads. One formula for every reader (the view, the workspace's warm-up and badge),
 * so they share one view-cache entry (viewCache keys by these dates) instead of each asking the server.
 */
export function bookingWindow(today: string, shift = 0): { from: string; to: string } {
  const from = addDays(weekStart(today), (shift - BOOKING_WEEKS_BEHIND) * 7);
  return { from, to: addDays(from, BOOKING_WEEKS * 7 - 1) };
}

// ---------------------------------------------------------------------------------------------------------------
// Hours other projects hold (who could take this task)

/** Hours held by bookings on OTHER projects, per person per day. Mirror of server/src/bookingLoad.ts — change both. */
export type HeldHours = Map<string, Map<string, number>>;

/**
 * What the assignment hints add to a person's own task load: their bookings on projects other than
 * `projectKey` (an unnamed project, `projectKey: null`, is other by definition), on the days they work.
 * Bookings on `projectKey` itself are left out: that project's tasks are how those hours get spent, so
 * adding them next to the tasks would count one promise twice.
 */
export function heldElsewhereByDay(input: {
  bookings: readonly Booking[];
  absences: readonly Pick<ResourceAbsence, "accountId" | "from" | "to">[];
  projectKey: string;
  from: string;
  to: string;
  calendar?: WorkCalendar;
}): HeldHours {
  const cal = input.calendar ?? DEFAULT_WORK_CALENDAR;
  const away = new Map<string, Pick<ResourceAbsence, "from" | "to">[]>();
  for (const a of input.absences) away.set(a.accountId, [...(away.get(a.accountId) ?? []), a]);
  const out: HeldHours = new Map();
  for (const b of input.bookings) {
    if (b.projectKey === input.projectKey) continue;
    const mine = away.get(b.accountId) ?? [];
    const perDay = out.get(b.accountId) ?? new Map<string, number>();
    const f = b.from > input.from ? b.from : input.from;
    const t = b.to < input.to ? b.to : input.to;
    if (t < f) continue;
    for (const date of eachDate(f, t)) {
      const off: BookDay["off"] = dayKind(date, cal) !== "work" ? "weekend" : isAwayOn(mine, date) ? "away" : null;
      const h = hoursOn(b, { date, off });
      if (h > 0) perDay.set(date, round2((perDay.get(date) ?? 0) + h));
    }
    if (perDay.size > 0) out.set(b.accountId, perDay);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Assigned against booked

/**
 * The work assigned to one person on a project in the two weeks ahead against what is booked for them on
 * it. null when they agree within an hour, or when assigned work does not exceed the booking: only "more
 * work than promised" is a gap worth a line (Resource's `.bk-gap`, and a row of Nhịp dự án).
 */
export function bookingGap(input: {
  person: Pick<PersonLoad, "days"> | undefined;
  bookings: readonly Booking[];
  absences: readonly Pick<ResourceAbsence, "from" | "to">[];
  accountId: string;
  projectKey: string;
  soon: { from: string; to: string };
  calendar?: WorkCalendar;
  /** How many more hours than booked it takes to be worth saying. */
  minGap?: number;
}): { assigned: number; booked: number } | null {
  if (!input.person) return null;
  const assigned = round1(input.person.days.filter((d) => d.date >= input.soon.from && d.date <= input.soon.to).reduce((s, d) => s + d.allocatedHours, 0));
  const booked =
    bookedHours({
      bookings: input.bookings,
      accountId: input.accountId,
      days: eachDate(input.soon.from, input.soon.to),
      absences: input.absences,
      calendar: input.calendar,
    }).byProject.get(input.projectKey) ?? 0;
  return assigned - booked > (input.minGap ?? 1) ? { assigned, booked } : null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------------------------------------------------
// The badge on the Resource lens

/**
 * People over capacity in the next two weeks by bookings, for the lens badge, when the project uses bookings
 * at all (at least one booking of this project reaching into the window). null otherwise: the caller then
 * counts by Mức tải, as before. `sheet` is the project-scoped read (the one the Resource lens draws).
 */
export function bookingBadge(
  sheet: { people: readonly BookingPerson[]; bookings: readonly Booking[]; absences: readonly ResourceAbsence[] },
  projectKey: string,
  soon: { from: string; to: string },
  calendar?: WorkCalendar
): number | null {
  if (!sheet.bookings.some((b) => b.projectKey === projectKey && b.from <= soon.to && b.to >= soon.from)) return null;
  return bookedCounts(buildBooked({ people: sheet.people, bookings: sheet.bookings, absences: sheet.absences, from: soon.from, to: soon.to, soon, calendar })).over;
}
