import { isoWeekday } from "./workCalendar";

/*
 * The short date forms the redesigned pages speak ("15/11", "T6 13/11"), shared by quickAdd, today and
 * projectPulse so a date reads the same in the quick-add preview, the Hôm nay page and the pulse headline.
 * Pure string work on "YYYY-MM-DD": no Date at local midnight, so nothing shifts in UTC+7 (BUG-04).
 */

/** ISO weekday (1 = Monday … 7 = Sunday) → "T2" … "T7", "CN". */
export const WEEKDAY_SHORT: Readonly<Record<number, string>> = { 1: "T2", 2: "T3", 3: "T4", 4: "T5", 5: "T6", 6: "T7", 7: "CN" };

/** ISO weekday → "Thứ Hai" … "Chủ nhật". */
export const WEEKDAY_LONG: Readonly<Record<number, string>> = {
  1: "Thứ Hai",
  2: "Thứ Ba",
  3: "Thứ Tư",
  4: "Thứ Năm",
  5: "Thứ Sáu",
  6: "Thứ Bảy",
  7: "Chủ nhật",
};

/**
 * "2026-11-15" → "15/11"; the year is added ("5/1/2027") only when it differs from `today`'s, because
 * a planner talks about this year's dates almost always and "15/11/2026" on every chip is noise.
 */
export function formatDayMonth(iso: string, today?: string): string {
  const d = Number(iso.slice(8, 10));
  const m = Number(iso.slice(5, 7));
  const base = `${d}/${m}`;
  return today && today.slice(0, 4) !== iso.slice(0, 4) ? `${base}/${iso.slice(0, 4)}` : base;
}

/** "2026-11-13" → "T6 13/11". */
export function formatWeekdayDayMonth(iso: string, today?: string): string {
  return `${WEEKDAY_SHORT[isoWeekday(iso)]} ${formatDayMonth(iso, today)}`;
}

/** "12/11–13/11" or "12–13/11" when both ends are in one month; a single day is just "12/11". */
export function formatDayRange(from: string, to: string, today?: string): string {
  if (from === to) return formatDayMonth(from, today);
  if (from.slice(0, 7) === to.slice(0, 7)) return `${Number(from.slice(8, 10))}–${formatDayMonth(to, today)}`;
  return `${formatDayMonth(from, today)}–${formatDayMonth(to, today)}`;
}
