import { weekAxisStart } from "./timelineGeometry";
import type { Granularity } from "./resourceAllocation";

/*
 * Where a date sits on gantt-task-react's own time axis, worked out from the same rules the library
 * uses to seed its columns (ganttDateRange/seedDates). The library keeps its scroll position in
 * pixels, so when the zoom or the column kind (day / week / month) changes, the pixel that was at
 * the left edge now stands for another date and the chart jumps. Knowing the axis lets the zoom
 * keep one date under the pointer (GanttView), the way the resource tab already does.
 *
 * Days are numbers of days since 1970-01-01 (UTC), fractional inside a day. Column 0 starts at x = 0.
 */

const MS_DAY = 86_400_000;

const parts = (iso: string) => [Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))] as const;

/** `YYYY-MM-DD` → whole days since the epoch (UTC). */
export function dayNumber(iso: string): number {
  const [y, m, d] = parts(iso);
  return Date.UTC(y, m, d) / MS_DAY;
}

/** The first column's date: one step before the earliest bar, the way the library's default pre-step does. */
export function axisOrigin(mode: Granularity, earliestStart: string): string {
  if (mode === "week") return weekAxisStart(earliestStart);
  const [y, m, d] = parts(earliestStart);
  if (mode === "day") return new Date(Date.UTC(y, m, d - 1)).toISOString().slice(0, 10);
  return new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
}

/** Day number of the first day of month column `i` (month columns start at the origin's month). */
function monthStart(origin: string, i: number): number {
  const [y, m] = parts(origin);
  return Date.UTC(y, m + i, 1) / MS_DAY;
}

/** The (fractional) day at chart x. Month columns are the same width however long the month is. */
export function pxToDay(mode: Granularity, origin: string, cellWidth: number, px: number): number {
  const base = dayNumber(origin);
  if (mode === "day") return base + px / cellWidth;
  if (mode === "week") return base + (px / cellWidth) * 7;
  const col = Math.floor(px / cellWidth);
  const start = monthStart(origin, col);
  const length = monthStart(origin, col + 1) - start;
  return start + ((px - col * cellWidth) / cellWidth) * length;
}

/** The chart x of a (fractional) day: the inverse of `pxToDay`. */
export function dayToPx(mode: Granularity, origin: string, cellWidth: number, day: number): number {
  const base = dayNumber(origin);
  if (mode === "day") return (day - base) * cellWidth;
  if (mode === "week") return ((day - base) / 7) * cellWidth;
  // Walk to the month that holds `day` (an average month is a safe first guess; fix it up by one step each way).
  let col = Math.floor((day - base) / 30.4375);
  while (col > 0 && monthStart(origin, col) > day) col--;
  while (monthStart(origin, col + 1) <= day) col++;
  const start = monthStart(origin, col);
  const length = monthStart(origin, col + 1) - start;
  return col * cellWidth + ((day - start) / length) * cellWidth;
}

/**
 * How much room the axis keeps on each side of the plan, in pixels at the current zoom (a little more
 * than a wide screen). The library ends its axis a few columns after the last bar, so a short plan was
 * a strip with blank page to its right, and — narrower than the pane — the browser pinned the scroll at
 * 0, so nothing could hold a date still across a Day / Week / Month handoff. With this much on both
 * sides the axis is always wider than the pane and the zoom can keep its date.
 */
export const AXIS_PAD_PX = 2000;

/** Whole 30-day steps (so the axis is not re-seeded on every wheel notch) covering `AXIS_PAD_PX` at this zoom. */
export function axisPadDays(pixelsPerDay: number): number {
  if (!(pixelsPerDay > 0)) return 0;
  return Math.ceil(AXIS_PAD_PX / pixelsPerDay / 30) * 30;
}

/**
 * The scroll position that keeps `day` at `pointerX` pixels from the left edge of the visible chart
 * once the axis is drawn as `mode`/`cellWidth` (never negative).
 */
export function scrollKeeping(
  mode: Granularity,
  origin: string,
  cellWidth: number,
  day: number,
  pointerX: number
): number {
  return Math.max(0, dayToPx(mode, origin, cellWidth, day) - pointerX);
}
