/** The part of a booking this file reads. Structural, so the client's tests can import this file without the server. */
export interface HeldBooking {
  accountId: string;
  from: string;
  to: string;
  hoursPerDay: number;
}

/**
 * Hours a person has promised to other projects: what the assistant's "who is free" and a sprint's
 * capacity must subtract before they look at this project's own work.
 *
 * `client/src/bookingModel.ts` `hoursOn` is the rule on the other side; this file is its mirror
 * (client/test/bookingModel.test.ts runs the same cases over both): a booking gives its hours on every
 * day of its range that is not off (the project's non-working days, and the person's leave); status
 * (tentative or confirmed) does not matter.
 *
 * Only bookings on OTHER projects are held against this one. A booking on the project being asked about
 * is how that project's own task hours get spent, so counting it next to the tasks would count one
 * promise twice.
 *
 * What comes out of here is hours and dates, never a project key: the viewer may not be allowed to browse
 * the project that holds the person.
 */

/** Mirror of client/src/bookingModel.ts hoursOn — change both. `off` is "the day is not worked by this person". */
export function hoursOn(b: Pick<HeldBooking, "from" | "to" | "hoursPerDay">, date: string, off: boolean): number {
  return !off && b.from <= date && date <= b.to ? b.hoursPerDay : 0;
}

/** The bookings that hold someone away from `projectKey`. */
export function heldElsewhere<T extends { projectKey: string | null }>(bookings: readonly T[], projectKey: string): T[] {
  return bookings.filter((b) => b.projectKey !== projectKey);
}

/** One person's held hours by date, over the dates given. Days off are absent. */
export function heldByDay(
  bookings: readonly HeldBooking[],
  accountId: string,
  dates: readonly string[],
  isOff: (date: string) => boolean
): Map<string, number> {
  const out = new Map<string, number>();
  const mine = bookings.filter((b) => b.accountId === accountId);
  if (mine.length === 0) return out;
  for (const date of dates) {
    const off = isOff(date);
    let hours = 0;
    for (const b of mine) hours += hoursOn(b, date, off);
    if (hours > 0) out.set(date, Math.round(hours * 100) / 100);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// One person across a window, week by week (the assistant's `bookings` tool)

export interface BookedWeek {
  /** The first day of the week inside the window (its Monday unless the window starts mid-week). */
  from: string;
  to: string;
  booked: number;
  capacity: number;
  /** capacity − booked, never below 0. */
  free: number;
  /** At least one day of the week is booked past its capacity. */
  over: boolean;
}

const DAY_MS = 86_400_000;
const round1 = (n: number) => Math.round(n * 10) / 10;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const utc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
/** 1 = Monday … 7 = Sunday, like workCalendar's weekdays. */
const weekday = (iso: string) => new Date(utc(iso)).getUTCDay() || 7;

/**
 * Hours booked against hours available, per week (Monday to Sunday, cut at the window's ends). `bookings` are
 * one person's, already shaped for the viewer; `isOff` is "not worked by this person" (calendar + leave).
 * Mirrors client/src/bookingModel.ts bookDays + weekCells.
 */
export function bookedWeeks(input: {
  bookings: ReadonlyArray<Pick<HeldBooking, "from" | "to" | "hoursPerDay">>;
  capacityHoursPerDay: number;
  from: string;
  to: string;
  isOff: (date: string) => boolean;
}): BookedWeek[] {
  type Week = BookedWeek & { overDay: boolean };
  const weeks: Week[] = [];
  let cur: Week | null = null;
  for (let ms = utc(input.from); ms <= utc(input.to); ms += DAY_MS) {
    const date = isoDay(ms);
    if (cur === null || weekday(date) === 1) {
      if (cur) weeks.push(cur);
      cur = { from: date, to: date, booked: 0, capacity: 0, free: 0, over: false, overDay: false };
    }
    const off = input.isOff(date);
    const capacity = off ? 0 : input.capacityHoursPerDay;
    let booked = 0;
    for (const b of input.bookings) booked += hoursOn(b, date, off);
    cur.to = date;
    cur.booked += booked;
    cur.capacity += capacity;
    if (capacity > 0 && booked > capacity + 1e-6) cur.overDay = true;
  }
  if (cur) weeks.push(cur);
  return weeks.map(({ overDay, ...w }) => ({
    ...w,
    booked: round1(w.booked),
    capacity: round1(w.capacity),
    free: round1(Math.max(0, w.capacity - w.booked)),
    over: overDay,
  }));
}
