import {
  addDays,
  defaultWindow,
  diffDays,
  monthWindow,
  weekdayOf,
  type Granularity,
  type PersonLoad,
} from "./resourceAllocation";
import { skillKey } from "./skillMatrix";
import type { Task } from "./types";

/*
 * Pure helpers for the resource tab's layout. They live outside the components
 * so the two things that are easy to get subtly wrong — where a task bar sits
 * against the heatmap's columns, and which preset a date window corresponds to —
 * can be tested without a browser.
 */

export interface ColumnSpan {
  start: string;
  end: string;
}

/**
 * The heatmap's columns as inclusive date ranges. Day = one date, week breaks on
 * Monday (the first column may be a partial week), month on the calendar month.
 * Same breaks as `aggregateWeeks`/`aggregateMonths`, so a task bar drawn from
 * these spans lines up with the cells drawn from those.
 */
export function columnSpans(dates: string[], granularity: Granularity): ColumnSpan[] {
  const spans: ColumnSpan[] = [];
  dates.forEach((d, i) => {
    const startsNew =
      i === 0 ||
      granularity === "day" ||
      (granularity === "week" ? weekdayOf(d) === 1 : d.slice(0, 7) !== dates[i - 1].slice(0, 7));
    if (startsNew) spans.push({ start: d, end: d });
    else spans[spans.length - 1].end = d;
  });
  return spans;
}

export interface BarPlacement {
  /** Distance from the grid's left edge, in columns (fractional inside a week or month column). */
  left: number;
  /** Length in columns. */
  width: number;
  clippedLeft: boolean;
  clippedRight: boolean;
}

/**
 * Where an inclusive date range sits on the column axis, clipped to the window.
 * In day mode `left`/`width` are whole numbers; by week or month a task that
 * starts on Wednesday starts 2/7 of the way into its column — the bar is exact
 * to the day even though the cells above it are not.
 */
export function placeBar(spans: ColumnSpan[], start: string, end: string): BarPlacement | null {
  if (spans.length === 0) return null;
  const first = spans[0].start;
  const last = spans[spans.length - 1].end;
  if (end < first || start > last) return null;
  const from = start < first ? first : start;
  const to = end > last ? last : end;

  const edge = (iso: string, after: boolean): number => {
    const at = spans.findIndex((c) => iso >= c.start && iso <= c.end);
    const col = spans[at];
    const length = diffDays(col.start, col.end) + 1;
    return at + (diffDays(col.start, iso) + (after ? 1 : 0)) / length;
  };
  const left = edge(from, false);
  return { left, width: edge(to, true) - left, clippedLeft: start < first, clippedRight: end > last };
}

/** A task's own dates as the bar draws them: a missing or inverted due date is a one-day bar. */
export function taskBarDates(task: Pick<Task, "startDate" | "dueDate">): { start: string; end: string } | null {
  if (!task.startDate) return null;
  return { start: task.startDate, end: task.dueDate && task.dueDate >= task.startDate ? task.dueDate : task.startDate };
}

/* ------------------------------------------------------------ date window */

export type RangePresetId = "month" | "4w" | "8w" | "quarter" | "all" | "project";

export const RANGE_PRESETS: Array<{ id: RangePresetId; label: string; days?: number }> = [
  { id: "month", label: "Tháng này" },
  { id: "4w", label: "4 tuần", days: 28 },
  { id: "8w", label: "8 tuần", days: 56 },
  { id: "quarter", label: "1 quý", days: 90 },
  { id: "all", label: "Toàn dự án" },
  { id: "project", label: "Theo dự án" },
];

type Window = { from: string; to: string };

/**
 * The window a preset asks for, or null for "follow the project" (the view then
 * stops holding a window of its own). The fixed-length presets keep the current
 * start, so picking "8 tuần" widens what you are already reading instead of
 * jumping somewhere else.
 */
export function rangeForPreset(id: RangePresetId, span: Window, today: string, tasks: Task[]): Window | null {
  if (id === "project") return null;
  if (id === "month") return monthWindow(today);
  if (id === "all") return defaultWindow(tasks, today, 3650);
  const days = RANGE_PRESETS.find((p) => p.id === id)?.days ?? 28;
  return { from: span.from, to: addDays(span.from, days - 1) };
}

/**
 * Which preset the current window is, for the dropdown's label. `null` when the
 * user typed their own dates. "Theo dự án" is the state where no window was
 * chosen at all, which is why it is read from `range === null` rather than from
 * the dates.
 */
export function currentPreset(range: Window | null, today: string, tasks: Task[]): RangePresetId | null {
  if (range === null) return "project";
  const same = (w: Window) => w.from === range.from && w.to === range.to;
  if (same(monthWindow(today))) return "month";
  if (same(defaultWindow(tasks, today, 3650))) return "all";
  const length = diffDays(range.from, range.to) + 1;
  return RANGE_PRESETS.find((p) => p.days === length)?.id ?? null;
}

/* ----------------------------------------------------------- people view */

export type PeopleView = "all" | "busy" | "over";

export interface PeopleCounts {
  all: number;
  busy: number;
  over: number;
}

/** "Có việc" = holds at least one task touching the window; "quá tải" = at least one over-capacity day. */
export function peopleCounts(people: PersonLoad[]): PeopleCounts {
  return {
    all: people.length,
    busy: people.filter((p) => p.tasks.length > 0).length,
    over: people.filter((p) => p.overloadedDays > 0).length,
  };
}

export function filterPeople(people: PersonLoad[], view: PeopleView): PersonLoad[] {
  if (view === "busy") return people.filter((p) => p.tasks.length > 0);
  if (view === "over") return people.filter((p) => p.overloadedDays > 0);
  return people;
}

/* ------------------------------------------------------- unassigned list */

/** The unassigned list's search box: key or title, ignoring case and diacritics ("dang nhap" finds "Đăng nhập"). */
export function filterUnassigned(tasks: Task[], query: string): Task[] {
  const needle = skillKey(query);
  if (!needle) return tasks;
  return tasks.filter((t) => skillKey(`${t.id} ${t.summary}`).includes(needle));
}

/* ------------------------------------------------------------- formatting */

/** 0.4286 → "43%"; a non-finite ratio (no capacity) → "—". */
export function pct(ratio: number): string {
  return Number.isFinite(ratio) ? `${Math.round(ratio * 100)}%` : "—";
}

/** "2026-11-04" → "04/11". */
export function shortDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}
