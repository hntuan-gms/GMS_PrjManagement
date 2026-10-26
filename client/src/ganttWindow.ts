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
export const BUFFER_ROWS = 40;
/** The window only moves in steps of this many rows: a re-render every 20 rows scrolled, not every row. */
export const CHUNK_ROWS = 20;

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

export function axisSentinels<T extends { start: Date; end: Date }>(
  all: T[],
  make: (id: string, start: Date, end: Date) => T
): T[] {
  if (all.length === 0) return [];
  let min = all[0].start.getTime();
  let max = all[0].end.getTime();
  for (const t of all) {
    if (t.start.getTime() < min) min = t.start.getTime();
    if (t.end.getTime() > max) max = t.end.getTime();
  }
  const DAY = 86_400_000;
  return [
    make(`${SENTINEL_PREFIX}start`, new Date(min), new Date(min + DAY)),
    make(`${SENTINEL_PREFIX}end`, new Date(max - DAY), new Date(max)),
  ];
}

export const isSentinel = (id: string): boolean => id.startsWith(SENTINEL_PREFIX);
