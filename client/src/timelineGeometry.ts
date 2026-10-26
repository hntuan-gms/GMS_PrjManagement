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
