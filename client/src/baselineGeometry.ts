import type { DateRange, OrderedTask } from "./ganttMapping";

const DAY_MS = 86_400_000;

/** gantt-task-react draws any bar narrower than two drag handles (2 × 8px) at exactly this width. */
const SMALL_BAR_PX = 16;
/** The strip sits in the ~8px gap gantt-task-react leaves under each bar (rowHeight 42, barFill 60%). */
const BASELINE_GAP = 1.5;
export const BASELINE_HEIGHT = 5;

const days = (from: string, to: string) =>
  Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / DAY_MS);

/**
 * The baseline each row is drawn against. An Epic with children takes the
 * min/max of its children's baselines, for the same reason its bar is the span
 * of its children (resolveRanges): its own stored baseline would compare a
 * rolled-up bar with dates nobody sees. Everything else keeps its own. A task
 * with no baseline has no entry — there is nothing to compare it with.
 */
export function resolveBaselines(ordered: OrderedTask[]): Map<string, DateRange> {
  const ids = new Set(ordered.map((o) => o.task.id));
  const childrenOf = new Map<string, string[]>();
  for (const o of ordered) {
    const parentId = o.task.wbsParentId;
    if (parentId && ids.has(parentId)) {
      if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
      childrenOf.get(parentId)!.push(o.task.id);
    }
  }

  const out = new Map<string, DateRange>();
  // Children follow their parent in WBS order, so walking backwards resolves
  // every child before the Epic that rolls it up.
  for (let i = ordered.length - 1; i >= 0; i--) {
    const t = ordered[i].task;
    const children = childrenOf.get(t.id) ?? [];
    if (t.issueType.toLowerCase() === "epic" && children.length > 0) {
      let start: string | null = null;
      let end: string | null = null;
      for (const id of children) {
        const b = out.get(id);
        if (!b) continue;
        if (!start || b.start < start) start = b.start;
        if (!end || b.end > end) end = b.end;
      }
      if (start && end) {
        out.set(t.id, { start, end });
        continue;
      }
    }
    if (t.baselineStart) {
      const end = t.baselineDue && t.baselineDue >= t.baselineStart ? t.baselineDue : t.baselineStart;
      out.set(t.id, { start: t.baselineStart, end });
    }
  }
  return out;
}

/** Calendar days the bar finishes after its baseline: positive = late, negative = early. */
export function slipDays(range: DateRange, baseline: DateRange): number {
  return days(baseline.end, range.end);
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where the baseline strip goes, anchored on the actual bar's own rect rather
 * than on a date→x formula of our own: the bar's left edge *is* its start date in
 * the library's coordinates, so only the offset from there needs a scale. That
 * scale is read off the bar itself when it is drawn at its true width (exact in
 * every view, including Month, whose columns are uneven calendar months), and
 * otherwise falls back to the zoom's nominal pixels-per-day. Clipped to the chart;
 * null when nothing of it would be on screen.
 */
export function baselineBox(
  bar: Box,
  range: DateRange,
  baseline: DateRange,
  fallbackPxPerDay: number,
  chartWidth: number
): Box | null {
  const span = days(range.start, range.end) + 1;
  const pxPerDay = bar.width > SMALL_BAR_PX + 0.5 ? bar.width / span : fallbackPxPerDay;
  let left = bar.x + days(range.start, baseline.start) * pxPerDay;
  let right = left + (days(baseline.start, baseline.end) + 1) * pxPerDay;
  left = Math.max(0, left);
  right = Math.min(chartWidth, right);
  if (right - left <= 0) return null;
  return { x: left, y: bar.y + bar.height + BASELINE_GAP, width: right - left, height: BASELINE_HEIGHT };
}

const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export function baselineTitle(baseline: DateRange, slip: number): string {
  const verdict =
    slip > 0 ? `Trễ ${slip} ngày so với baseline` : slip < 0 ? `Sớm ${-slip} ngày so với baseline` : "Đúng baseline";
  return `Baseline: ${dmy(baseline.start)} – ${dmy(baseline.end)} · ${verdict}`;
}
