import type { BarRect } from "./dependencyGeometry";
import type { Task } from "./types";

/**
 * Where things that are not bars sit on the Gantt, worked out from the bars the
 * library already drew (useBarRects): a baseline under its bar, a release line at
 * its date, a milestone diamond at its end.
 *
 * Each position is measured from a bar's OWN scale (its pixel width over its day
 * count) and the nearest bar's origin, never from one global pixels-per-day. In Day
 * and Week mode the two agree; in Month mode a column is 28–31 days wide but always
 * the same number of pixels, so days are not a fixed width — measuring locally keeps
 * the error to a fraction of a day instead of letting it grow across the chart.
 */

export interface DateRange {
  start: string;
  end: string;
}

/** Whole days from `a` to `b` (both YYYY-MM-DD), negative when b is earlier. UTC, like every date in the app. */
export function daysBetween(a: string, b: string): number {
  const ms = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Math.round((ms(b) - ms(a)) / 86_400_000);
}

/** Pixels per day on this bar: its width over the days it spans (inclusive of both ends). */
export function dayWidth(rect: BarRect, range: DateRange): number {
  return rect.width / (daysBetween(range.start, range.end) + 1);
}

/** The x of the START of `date` (its left edge), from the bar whose own start is nearest to it. */
export function dateX(refs: Array<{ rect: BarRect; range: DateRange }>, date: string): number | null {
  let best: { rect: BarRect; range: DateRange } | null = null;
  let bestGap = Infinity;
  for (const r of refs) {
    const gap = Math.abs(daysBetween(r.range.start, date));
    if (gap < bestGap) {
      best = r;
      bestGap = gap;
    }
  }
  if (!best) return null;
  return best.rect.x + daysBetween(best.range.start, date) * dayWidth(best.rect, best.range);
}

/**
 * Jira has no milestone, so this app's convention is: the label "milestone" (or an
 * issue type of that name). It is a way of saying "this date matters", drawn as a
 * diamond — it changes nothing about scheduling.
 */
export function isMilestone(t: Pick<Task, "labels" | "issueType">): boolean {
  return t.issueType.toLowerCase() === "milestone" || t.labels.some((l) => l.toLowerCase() === "milestone");
}

/** A bar the library drew and the dates it stands for: the ruler that pixels and dates are converted with. */
export interface DateRef {
  rect: BarRect;
  range: DateRange;
}

/** gantt-task-react draws any bar narrower than two drag handles (2 × 8px) at exactly this width. */
export const SMALL_BAR_PX = 16;

/** `iso` moved by `days` (negative = earlier), UTC like every date in the app. */
export function shiftDay(iso: string, days: number): string {
  const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + days));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Pixels per day on one bar: its own width over its days, unless the library drew it at the
 * minimum width (then the width says nothing about the scale and the zoom's nominal one is used).
 */
function scaleOf(ref: DateRef, fallbackPxPerDay: number): number {
  return ref.rect.width > SMALL_BAR_PX + 0.5 ? dayWidth(ref.rect, ref.range) : fallbackPxPerDay;
}

/**
 * The day under chart x, measured from the bar nearest to it horizontally — the same rule `dateX`
 * follows in the other direction. `x` is in the chart SVG's own coordinates. The day is the one whose
 * column contains x, so the left edge of a bar is its start date.
 */
export function dateAtX(refs: DateRef[], x: number, fallbackPxPerDay: number): string | null {
  let best: DateRef | null = null;
  let bestGap = Infinity;
  for (const r of refs) {
    const gap = x < r.rect.x ? r.rect.x - x : x > r.rect.x + r.rect.width ? x - (r.rect.x + r.rect.width) : 0;
    if (gap < bestGap) {
      best = r;
      bestGap = gap;
    }
  }
  if (!best) return null;
  return shiftDay(best.range.start, Math.floor((x - best.rect.x) / scaleOf(best, fallbackPxPerDay)));
}

/**
 * Left edge of `date`'s column on the chart, from the bar whose start is nearest to it; `dateX`
 * with a fallback scale for bars the library drew at its minimum width.
 */
export function dateEdgeX(refs: DateRef[], date: string, fallbackPxPerDay: number): number | null {
  let best: DateRef | null = null;
  let bestGap = Infinity;
  for (const r of refs) {
    const gap = Math.abs(daysBetween(r.range.start, date));
    if (gap < bestGap) {
      best = r;
      bestGap = gap;
    }
  }
  if (!best) return null;
  return best.rect.x + daysBetween(best.range.start, date) * scaleOf(best, fallbackPxPerDay);
}

/** What dragging from day `a` to day `b` (either order) schedules: the start and the inclusive day count. */
export function dragSpan(a: string, b: string): { start: string; durationDays: number } {
  const start = a <= b ? a : b;
  const end = a <= b ? b : a;
  return { start, durationDays: daysBetween(start, end) + 1 };
}

/**
 * Where the invisible bar of an unscheduled row sits: today, kept inside what the dated bars span
 * so it never widens the chart's date axis (the library sizes the axis from every task it is given).
 */
export function anchorDay(today: string, datedStart: string | null, datedEnd: string | null): string {
  if (!datedStart || !datedEnd) return today;
  if (today < datedStart) return datedStart;
  if (today > datedEnd) return datedEnd;
  return today;
}

/**
 * The first column's date on gantt-task-react's Week axis: the Monday on or before the earliest bar's start,
 * one week earlier (the library's default of one pre-step). Column `i` then starts `7 * i` days later, which is
 * how the "W44" labels are turned into the date the week starts on.
 */
export function weekAxisStart(earliestStart: string, preSteps = 1): string {
  const dow = (new Date(Date.UTC(Number(earliestStart.slice(0, 4)), Number(earliestStart.slice(5, 7)) - 1, Number(earliestStart.slice(8, 10)))).getUTCDay() + 6) % 7;
  return shiftDay(earliestStart, -dow - 7 * preSteps);
}
