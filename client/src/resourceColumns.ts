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

/**
 * Where "today" sits inside one week or month column, as shares (0–1) of that column: the same day-wide mark
 * the opened rows draw with `placeBar`, so the load grid and the rows beneath it show one line, not two.
 */
export function todayInColumn(start: string, end: string, today: string): { left: number; width: number } | null {
  if (today < start || today > end) return null;
  const length = diffDays(start, end) + 1;
  return { left: diffDays(start, today) / length, width: 1 / length };
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

/**
 * What is written on a task's bar under a person. Hours only when Jira has an estimate: a task with none
 * used to show days × the *assignee's* hours a day, so the same task read 184h on someone at 8h/day and
 * 552h on someone at 24h/day. Without an estimate the honest figure is the schedule's own: its days.
 */
export function taskBarLabel(task: Pick<Task, "estimateHours" | "durationDays">): { text: string; estimated: boolean } {
  if (task.estimateHours != null) return { text: `${Math.round(task.estimateHours * 10) / 10}h`, estimated: true };
  return { text: `${task.durationDays} ngày`, estimated: false };
}

/**
 * The most hours a day a person can be given in their profile. "24h/ngày" was typed by mistake on three
 * people of one project and, because it is accepted as a fact, divided their load by three. The server
 * enforces the same bound (routes/resources.ts); change both.
 */
export const MAX_CAPACITY_HOURS = 16;

/** The profile's "giờ/ngày" box: a number (comma or point) above 0 and not over the bound, or the sentence to show. */
export function parseCapacity(text: string): { ok: true; hours: number } | { ok: false; message: string } {
  const hours = Number(text.trim().replace(",", "."));
  if (text.trim() === "" || !Number.isFinite(hours) || hours <= 0 || hours > MAX_CAPACITY_HOURS) {
    return { ok: false, message: `Công suất từ 0,5 đến ${MAX_CAPACITY_HOURS} giờ mỗi ngày.` };
  }
  return { ok: true, hours };
}

/* ----------------------------------------------------------- people view */

export type PeopleView = "all" | "busy" | "over";

export interface PeopleCounts {
  all: number;
  busy: number;
  over: number;
}

/** Whether a person counts as "quá tải": by default any over-capacity day in the whole window; the tab passes the next two weeks. */
export type IsOver = (p: PersonLoad) => boolean;
const overAnywhere: IsOver = (p) => p.overloadedDays > 0;

/** "Có việc" = holds at least one task touching the window; "quá tải" = over capacity by `isOver`. */
export function peopleCounts(people: PersonLoad[], isOver: IsOver = overAnywhere): PeopleCounts {
  return {
    all: people.length,
    busy: people.filter((p) => p.tasks.length > 0).length,
    over: people.filter(isOver).length,
  };
}

export function filterPeople(people: PersonLoad[], view: PeopleView, isOver: IsOver = overAnywhere): PersonLoad[] {
  if (view === "busy") return people.filter((p) => p.tasks.length > 0);
  if (view === "over") return people.filter(isOver);
  return people;
}

/**
 * Row order on the Nhân lực tab (plan §6.7). "load" keeps buildResourceLoad's own order (most
 * overloaded first); "least-free" is Runn's "least available" — whoever has the least room in the
 * window, which is who to protect; "most-free" is who to hand the next task to.
 */
export type PeopleSort = "load" | "least-free" | "most-free" | "name";

export const PEOPLE_SORT_LABEL: Record<PeopleSort, string> = {
  load: "Quá tải trước",
  "least-free": "Ít rảnh nhất",
  "most-free": "Rảnh nhất",
  name: "Tên",
};

export function sortPeople(people: PersonLoad[], mode: PeopleSort): PersonLoad[] {
  if (mode === "load") return people;
  const free = (p: PersonLoad) => p.capacityHours - p.allocatedHours;
  const byName = (a: PersonLoad, b: PersonLoad) => a.displayName.localeCompare(b.displayName, "vi");
  const out = [...people];
  if (mode === "name") return out.sort(byName);
  if (mode === "least-free") return out.sort((a, b) => free(a) - free(b) || byName(a, b));
  return out.sort((a, b) => free(b) - free(a) || byName(a, b));
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

/* ---------------------------------------------------------- the one window of "now" */

/**
 * Every figure about how loaded someone is *now* — the red "quá tải" pill and count, the number by
 * a name, the opened person's summary and the profile's header — is measured over this one window:
 * today and the 13 days after it. Four windows (whole project, four weeks, two weeks, whatever range
 * was picked) gave one person four different percentages.
 */
export const SOON_LABEL = "2 tuần tới";
/** The window the overload badge by a name counts: today and the 13 days after it. */
export function overloadWindow(today: string): { from: string; to: string } {
  return { from: today, to: addDays(today, 13) };
}
