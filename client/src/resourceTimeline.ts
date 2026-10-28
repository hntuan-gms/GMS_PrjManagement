import { addDays, diffDays, type Granularity } from "./resourceAllocation";
import { pct } from "./resourceColumns";
import type { Task } from "./types";

/*
 * Pure helpers for how the resource tab *reads* time: the labels on the heatmap and the slider that
 * moves its window. Kept out of the components so the edge cases (a month with four days showing,
 * a window dragged past the end of the project) are tested without a browser.
 */

/* ------------------------------------------------------- humane labels */

/** "2026-11-01" → "01/11/2026". */
export function formatDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/**
 * What a heatmap cell says when hovered. A day nobody can work on says so instead of "0h / 0h (0%)",
 * which reads as a bug; work that was nonetheless put on such a day is the one thing worth adding.
 */
export function cellTooltip(c: {
  start: string;
  end: string;
  allocated: number;
  capacity: number;
  ratio: number;
  taskIds: string[];
}): string {
  const when = c.start === c.end ? formatDate(c.start) : `${formatDate(c.start)} → ${formatDate(c.end)}`;
  const head =
    c.capacity <= 0
      ? `${when} · Ngày nghỉ${c.allocated > 0 ? ` · ${c.allocated}h việc bị xếp vào ngày nghỉ` : ""}`
      : `${when} · ${c.allocated}h / ${c.capacity}h (${pct(c.ratio)})`;
  const ids = [...new Set(c.taskIds)];
  return ids.length > 0 ? `${head}\n${ids.join(", ")}` : head;
}

export interface MonthLabel {
  /** Groups adjacent columns of the same month (or year). */
  key: string;
  full: string;
  /** Used when the band is too narrow for `full`; `min` when it is too narrow for this too. */
  mid: string;
  min: string;
}

/**
 * The band above the columns. By day or week it is the month; by month the columns are months
 * themselves, so the band is the year. Three lengths of the same label: a month with four days
 * showing is narrow and "Thg 10/2026" does not fit in it.
 */
export function monthLabel(start: string, granularity: Granularity): MonthLabel {
  const year = start.slice(0, 4);
  if (granularity === "month") return { key: year, full: `Năm ${year}`, mid: year, min: `’${year.slice(2)}` };
  const m = Number(start.slice(5, 7));
  return { key: `${year}-${m}`, full: `Thg ${m}/${year}`, mid: `T${m}/${year.slice(2)}`, min: `T${m}` };
}

/* ------------------------------------------------------------ the slider */

export interface DateWindow {
  from: string;
  to: string;
}

const MAX_EXTENT_DAYS = 1100;

/**
 * The stretch of time the slider covers: every dated task, today with a month behind and three
 * ahead, and whatever window is on screen — plus a week of margin so the thumb can reach the ends.
 * Capped, so one task dated in 2099 cannot shrink the thumb to nothing.
 */
export function scrubExtent(tasks: Task[], today: string, span: DateWindow): DateWindow {
  let from = addDays(today, -30);
  let to = addDays(today, 90);
  for (const t of tasks) {
    if (!t.startDate) continue;
    if (t.startDate < from) from = t.startDate;
    const end = t.dueDate && t.dueDate > t.startDate ? t.dueDate : t.startDate;
    if (end > to) to = end;
  }
  if (diffDays(from, to) > MAX_EXTENT_DAYS) {
    from = addDays(span.from, -365);
    to = addDays(span.to, 730);
  }
  if (span.from < from) from = span.from;
  if (span.to > to) to = span.to;
  return { from: addDays(from, -7), to: addDays(to, 7) };
}

const clampDate = (iso: string, lo: string, hi: string) => (iso < lo ? lo : iso > hi ? hi : iso);

/** The same-length window moved by `days`, stopping at the ends of the extent rather than shrinking. */
export function slideWindow(span: DateWindow, days: number, extent: DateWindow): DateWindow {
  const length = diffDays(span.from, span.to);
  const from = clampDate(addDays(span.from, days), extent.from, addDays(extent.to, -length));
  return { from, to: addDays(from, length) };
}

/** One edge dragged to `date`; the window never gets shorter than `minDays` or leaves the extent. */
export function resizeWindow(span: DateWindow, edge: "from" | "to", date: string, extent: DateWindow, minDays = 7): DateWindow {
  if (edge === "from") return { from: clampDate(date, extent.from, addDays(span.to, -(minDays - 1))), to: span.to };
  return { from: span.from, to: clampDate(date, addDays(span.from, minDays - 1), extent.to) };
}

/** The smallest window containing both; `b` may be absent. */
export function unionWindow(a: DateWindow, b: DateWindow | null): DateWindow {
  return b ? { from: a.from < b.from ? a.from : b.from, to: a.to > b.to ? a.to : b.to } : a;
}

/** The date a fraction (0–1) of the way along the extent. */
export function dateAtFraction(extent: DateWindow, fraction: number): string {
  return addDays(extent.from, Math.round(Math.max(0, Math.min(1, fraction)) * diffDays(extent.from, extent.to)));
}
