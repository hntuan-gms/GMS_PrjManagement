/*
 * One way to write a date (plan 0-5). Dates are "YYYY-MM-DD" strings and are only ever cut apart, never
 * run through `Date`, so the browser's time zone cannot move a label by a day (BUG-04).
 *
 *   month, full        Tháng 10/2026
 *   month, short       T10/26
 *   month, tiny        T10
 *   week column        02/11            (the date its week starts on)
 *   range              02/11 – 08/11/2026
 *   one date in text   16/9, or 16/9/2027 when it is not in the reference year
 */

export interface MonthLabels {
  full: string;
  short: string;
  tiny: string;
}

const part = (iso: string) => ({ y: iso.slice(0, 4), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) });
const two = (n: number) => String(n).padStart(2, "0");

/** The three lengths of a month's name, for a band that may be wide or narrow. */
export function monthLabels(iso: string): MonthLabels {
  const { y, m } = part(iso);
  return { full: `Tháng ${m}/${y}`, short: `T${m}/${y.slice(2)}`, tiny: `T${m}` };
}

/** A week column is named by the date its week starts on: "02/11". */
export function weekColumnLabel(weekStart: string): string {
  const { m, d } = part(weekStart);
  return `${two(d)}/${two(m)}`;
}

/** "DD/MM/YYYY". */
export function fullDate(iso: string): string {
  const { y, m, d } = part(iso);
  return `${two(d)}/${two(m)}/${y}`;
}

/**
 * "02/11 – 08/11/2026": the year is written once, at the end. A range across two years writes both
 * ("28/12/2026 – 03/01/2027"); a single day is just that day.
 */
export function formatRange(from: string, to: string): string {
  if (from === to) return fullDate(from);
  const a = part(from);
  const b = part(to);
  if (a.y !== b.y) return `${fullDate(from)} – ${fullDate(to)}`;
  return `${two(a.d)}/${two(a.m)} – ${fullDate(to)}`;
}

/**
 * A short span for a chip: "12/11", "12–14/11" in one month, "30/10–02/11" across two. No year; for
 * leave and the like where the surrounding screen already says which year it is.
 */
export function shortRange(from: string, to: string): string {
  const a = part(from);
  const b = part(to);
  if (from === to) return `${a.d}/${a.m}`;
  if (a.y === b.y && a.m === b.m) return `${a.d}–${b.d}/${b.m}`;
  return `${two(a.d)}/${two(a.m)}–${two(b.d)}/${two(b.m)}`;
}

/**
 * A single date inside a sentence: "16/9", and "16/9/2027" when it is not in the year of `today`.
 * `today` is a parameter, not read here, so the answer is testable and follows the caller's day.
 */
export function shortDay(iso: string, today: string): string {
  const { y, m, d } = part(iso);
  return y === today.slice(0, 4) ? `${d}/${m}` : `${d}/${m}/${y}`;
}
