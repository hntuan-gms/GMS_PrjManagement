import type { Granularity } from "./resourceAllocation";

/*
 * Zoom of a time axis, shared by the Gantt and the resource tab. One number — pixels per day —
 * is the whole state: which of day / week / month columns is showing, and how wide each one is,
 * are derived from it, so the two can never disagree and the same gesture means the same thing
 * on both screens. Zoom only ever changes the horizontal scale; rows keep their height.
 */

/** Calendar days one column spans (a month is the average; the real one varies by a day or two). */
export const DAYS_PER_COLUMN: Record<Granularity, number> = { day: 1, week: 7, month: 30.4 };

/** A column narrower than this cannot hold its own label. */
export const MIN_CELL = 22;
/** Wider than this, zooming further only wastes the screen. */
export const MAX_CELL = 160;
/** A week column needs a little more than a day column to fit "12/10". */
const MIN_WEEK_CELL = 30;

export const MIN_PIXELS_PER_DAY = MIN_CELL / DAYS_PER_COLUMN.month;
export const MAX_PIXELS_PER_DAY = 64;

/** Where each Day / Week / Month choice puts the zoom. Each lands inside its own band in `pickScale`. */
export const DEFAULT_PIXELS_PER_DAY: Record<Granularity, number> = {
  day: MIN_CELL,
  week: 46 / DAYS_PER_COLUMN.week,
  month: 90 / DAYS_PER_COLUMN.month,
};

/** How much one notch of pinch or Ctrl+wheel changes the zoom: a full gesture crosses about one mode's band. */
const ZOOM_PER_DELTA = 0.0009;

/**
 * Day columns while they fit at their minimum width, then week columns while those fit, then
 * month — the finest granularity that still has room, so zooming out hands off by itself.
 */
export function pickScale(pixelsPerDay: number): { granularity: Granularity; cellWidth: number } {
  const day = pixelsPerDay * DAYS_PER_COLUMN.day;
  if (day >= MIN_CELL) return { granularity: "day", cellWidth: Math.min(MAX_CELL, day) };
  const week = pixelsPerDay * DAYS_PER_COLUMN.week;
  if (week >= MIN_WEEK_CELL) return { granularity: "week", cellWidth: Math.min(MAX_CELL, week) };
  const month = pixelsPerDay * DAYS_PER_COLUMN.month;
  return { granularity: "month", cellWidth: Math.min(MAX_CELL, Math.max(MIN_CELL, month)) };
}

/** The zoom after one wheel event. `deltaY < 0` (pinch out, scroll up) zooms in. */
export function zoomByWheel(
  pixelsPerDay: number,
  deltaY: number,
  min = MIN_PIXELS_PER_DAY,
  max = MAX_PIXELS_PER_DAY
): number {
  return Math.min(max, Math.max(min, pixelsPerDay * Math.exp(-deltaY * ZOOM_PER_DELTA)));
}
