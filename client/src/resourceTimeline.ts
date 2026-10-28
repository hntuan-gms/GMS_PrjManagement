import { addDays, diffDays, type Granularity } from "./resourceAllocation";
import { pct } from "./resourceColumns";
import type { Task } from "./types";

/*
 * Pure helpers for how the resource tab *reads* time: the labels on the heatmap and how far its time
 * axis reaches. Kept out of the components so the edge cases (a month with four days showing, a
 * project dated far in the future) are tested without a browser.
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

/* ------------------------------------------------------------ the time axis */

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
