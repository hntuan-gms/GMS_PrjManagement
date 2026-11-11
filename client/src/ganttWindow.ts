/**
 * Row windowing for a big Gantt. gantt-task-react draws every row it is given, so a project
 * with thousands of tasks put tens of thousands of DOM nodes on the page and made every
 * scroll, selection and drag pay for all of them. Past WINDOW_THRESHOLD rows GanttView hands
 * the library only a window of rows around what is on screen; the page's own scrollbar
 * (a native one, over a spacer as tall as the whole list) decides which window.
 *
 * Pure arithmetic lives here so it can be tested without a browser.
 */

/** Below this the chart is drawn whole, exactly as it always was. */
export const WINDOW_THRESHOLD = 250;
/** Rows drawn above and below the visible ones, so a fast scroll does not outrun the window. */
export const BUFFER_ROWS = 30;
/**
 * The window only moves in steps of this many rows: a re-render every 40 rows scrolled, not every row. Every
 * move re-renders the whole window (table, bars, arrows, label measuring), so fewer, equally sized moves are
 * fewer long frames: the window is the same size as with 40 buffer + 20 chunk (viewport + 100 rows), and the
 * buffer left on each side is never below BUFFER_ROWS.
 */
export const CHUNK_ROWS = 40;

export const isWindowed = (rowCount: number): boolean => rowCount > WINDOW_THRESHOLD;

/** How many rows are drawn for a viewport that shows `viewportRows`. */
export const windowRows = (viewportRows: number): number => viewportRows + 2 * BUFFER_ROWS + CHUNK_ROWS;

/** First row to draw for this scroll position: a whole chunk, never so late that the viewport lacks its buffer. */
export function windowStartFor(scrollTop: number, rowHeight: number, rowCount: number, viewportRows: number): number {
  const maxStart = Math.max(0, rowCount - windowRows(viewportRows));
  const firstVisible = Math.floor(scrollTop / rowHeight);
  const snapped = Math.floor(Math.max(0, firstVisible - BUFFER_ROWS) / CHUNK_ROWS) * CHUNK_ROWS;
  return Math.min(snapped, maxStart);
}

/** One past the last row to draw. */
export const windowEnd = (start: number, rowCount: number, viewportRows: number): number =>
  Math.min(rowCount, start + windowRows(viewportRows));

/**
 * The library sizes its date axis from the tasks it is given, so a sliding window would
 * make the whole chart shift sideways as it moved. Two invisible tasks — the earliest start
 * and the latest end of the WHOLE list — go along with every window to pin the axis.
 */
export const SENTINEL_PREFIX = "__gms-axis-";

/** `start`, when given, is where the axis begins (see stickyAxisStart); otherwise the plan's start minus the pad. */
export function axisSentinels<T extends { start: Date; end: Date }>(
  all: T[],
  make: (id: string, start: Date, end: Date) => T,
  padDays = 0,
  start?: Date | null
): T[] {
  if (all.length === 0) return [];
  let min = all[0].start.getTime();
  let max = all[0].end.getTime();
  for (const t of all) {
    if (t.start.getTime() < min) min = t.start.getTime();
    if (t.end.getTime() > max) max = t.end.getTime();
  }
  const DAY = 86_400_000;
  const from = start ?? shiftDays(new Date(min), -padDays);
  return [
    make(`${SENTINEL_PREFIX}start`, from, new Date(from.getTime() + DAY)),
    make(`${SENTINEL_PREFIX}end`, shiftDays(new Date(max - DAY), padDays), shiftDays(new Date(max), padDays)),
  ];
}

/**
 * One invisible task covering the whole plan plus `padDays` either side: the same axis as the pair
 * above for a chart that is not windowed, at the price of one empty row instead of two.
 */
export function axisSpan<T extends { start: Date; end: Date }>(
  all: T[],
  make: (id: string, start: Date, end: Date) => T,
  padDays: number,
  start?: Date | null
): T[] {
  if (all.length === 0) return [];
  let min = all[0].start;
  let max = all[0].end;
  for (const t of all) {
    if (t.start < min) min = t.start;
    if (t.end > max) max = t.end;
  }
  return [make(`${SENTINEL_PREFIX}span`, start ?? shiftDays(min, -padDays), shiftDays(max, padDays))];
}

/**
 * Where the date axis begins, kept where it was while that still works.
 *
 * The library draws its first column from the earliest task it is given, and keeps its scroll position in
 * pixels. When the axis began exactly `padDays` before the plan, dragging the plan's earliest bar three days
 * moved the axis three days too, and every bar on screen — the dropped one included — slid by three days the
 * other way: the bar went forward with the mouse, jumped back on release, and (once the save came back) forward
 * again. Now the start stays put as long as the plan keeps at least half the pad before it and no more than
 * twice the pad (so a plan that moved far away does not leave a wide empty strip); only then is it re-seated
 * at `padDays` before the plan.
 */
export function stickyAxisStart(prev: Date | null, earliest: Date, padDays: number): Date {
  const ideal = shiftDays(earliest, -padDays);
  if (!prev) return ideal;
  const roomDays = Math.round((earliest.getTime() - prev.getTime()) / 86_400_000);
  return roomDays >= padDays / 2 && roomDays <= padDays * 2 ? prev : ideal;
}

function shiftDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export const isSentinel = (id: string): boolean => id.startsWith(SENTINEL_PREFIX);
