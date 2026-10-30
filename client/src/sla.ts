import type { SlaSettings, Task } from "./types";

/**
 * The SLA clock, computed here and only here — the way resourceAllocation.ts owns the
 * load. Everything that shows an SLA (the WBS column and its CSV, the task window, the
 * "Trễ SLA" filter, the report tiles) reads one `computeSla` map, so a chip and a count
 * cannot disagree. Pure and React-free so it can be tested; `nowMs` is a parameter.
 *
 * The clock starts when the issue was created and runs only in working time: the
 * policy's working weekdays and periods of the day, minus its holidays, read in the
 * policy's own timezone (not the browser's — everyone must see the same deadline).
 * A finished issue is judged by when it was resolved.
 */

export type SlaState = "ok" | "warn" | "breached" | "met" | "missed";

export interface SlaResult {
  state: SlaState;
  targetHours: number;
  dueMs: number;
  /**
   * Working time between now (or, once done, the resolution) and the deadline.
   * Positive = time left / spare; negative = how late, in working time.
   */
  remainingMs: number;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** How far the day walk may go — ten years of calendar. A guard, never a real limit. */
const MAX_DAYS = 3_700;

export interface SlaCalendar {
  tzMs: number;
  workDays: Set<number>;
  holidays: Set<string>;
  /** Minutes after local midnight, ascending. */
  periods: Array<[number, number]>;
  /** Working minutes in one working day. */
  dayMinutes: number;
}

function minutesOf(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

export function makeCalendar(s: SlaSettings): SlaCalendar {
  const periods = s.periods
    .map((p) => [minutesOf(p.start), minutesOf(p.end)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  return {
    tzMs: s.tzOffsetMinutes * 60_000,
    workDays: new Set(s.workDays),
    holidays: new Set(s.holidays.map((h) => h.date)),
    periods,
    dayMinutes: periods.reduce((sum, [a, b]) => sum + (b - a), 0),
  };
}

/** Days since 1970-01-01 in the calendar's timezone. */
function dayIndexOf(ms: number, cal: SlaCalendar): number {
  return Math.floor((ms + cal.tzMs) / DAY_MS);
}

/** The calendar day (YYYY-MM-DD) an instant falls on, in the calendar's timezone. */
export function localDateOf(ms: number, cal: SlaCalendar): string {
  return new Date(dayIndexOf(ms, cal) * DAY_MS).toISOString().slice(0, 10);
}

function isWorkingDay(day: number, cal: SlaCalendar): boolean {
  // 1970-01-01 was a Thursday (ISO weekday 4).
  const isoWeekday = (((day + 3) % 7) + 7) % 7 + 1;
  if (!cal.workDays.has(isoWeekday)) return false;
  return !cal.holidays.has(new Date(day * DAY_MS).toISOString().slice(0, 10));
}

/** Working periods of one day as UTC instants. */
function periodsOf(day: number, cal: SlaCalendar): Array<[number, number]> {
  const midnight = day * DAY_MS - cal.tzMs;
  return cal.periods.map(([a, b]) => [midnight + a * 60_000, midnight + b * 60_000]);
}

/** Working time between two instants (0 if `to` is not after `from`). */
export function workingMsBetween(fromMs: number, toMs: number, cal: SlaCalendar): number {
  if (!(toMs > fromMs)) return 0;
  const first = dayIndexOf(fromMs, cal);
  const last = Math.min(dayIndexOf(toMs, cal), first + MAX_DAYS);
  let total = 0;
  for (let day = first; day <= last; day++) {
    if (!isWorkingDay(day, cal)) continue;
    for (const [ps, pe] of periodsOf(day, cal)) {
      const overlap = Math.min(pe, toMs) - Math.max(ps, fromMs);
      if (overlap > 0) total += overlap;
    }
  }
  return total;
}

/**
 * The instant `ms` of working time after `fromMs`. Work created outside working time
 * starts counting at the next working period. NaN if the calendar has no working
 * time at all within the guard (validation makes that impossible for a saved policy).
 */
export function addWorkingMs(fromMs: number, ms: number, cal: SlaCalendar): number {
  let left = ms;
  const first = dayIndexOf(fromMs, cal);
  for (let day = first; day <= first + MAX_DAYS; day++) {
    if (!isWorkingDay(day, cal)) continue;
    for (const [ps, pe] of periodsOf(day, cal)) {
      const start = Math.max(ps, fromMs);
      if (pe <= start) continue;
      if (left <= pe - start) return start + left;
      left -= pe - start;
    }
  }
  return Number.NaN;
}

/** Whether the policy measures this kind of issue. Epics are containers, never measured by default. */
function measuresType(task: Task, s: SlaSettings): boolean {
  if (s.issueTypes.length > 0) return s.issueTypes.includes(task.issueType);
  return task.issueType.toLowerCase() !== "epic";
}

/** Priority name (folded) → target hours, null entries left out. */
function targetIndex(s: SlaSettings): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of s.targets) if (t.hours && t.hours > 0) out.set(t.priority.trim().toLowerCase(), t.hours);
  return out;
}

/** One task's SLA, or null when the policy does not measure it. */
export function slaFor(
  task: Task,
  s: SlaSettings,
  nowMs: number,
  cal: SlaCalendar = makeCalendar(s),
  targets: Map<string, number> = targetIndex(s)
): SlaResult | null {
  if (!s.enabled || cal.dayMinutes <= 0 || !measuresType(task, s)) return null;
  const hours = task.priority ? targets.get(task.priority.trim().toLowerCase()) : undefined;
  if (!hours) return null;
  const createdMs = task.createdAt ? Date.parse(task.createdAt) : Number.NaN;
  if (Number.isNaN(createdMs)) return null;
  if (s.appliesFrom && localDateOf(createdMs, cal) < s.appliesFrom) return null;
  const dueMs = addWorkingMs(createdMs, hours * HOUR_MS, cal);
  if (Number.isNaN(dueMs)) return null;

  if (task.statusCategory === "done") {
    const doneMs = task.resolvedAt ? Date.parse(task.resolvedAt) : Number.NaN;
    if (Number.isNaN(doneMs)) return null;
    return doneMs <= dueMs
      ? { state: "met", targetHours: hours, dueMs, remainingMs: workingMsBetween(doneMs, dueMs, cal) }
      : { state: "missed", targetHours: hours, dueMs, remainingMs: -workingMsBetween(dueMs, doneMs, cal) };
  }
  if (nowMs > dueMs) {
    return { state: "breached", targetHours: hours, dueMs, remainingMs: -workingMsBetween(dueMs, nowMs, cal) };
  }
  const remainingMs = workingMsBetween(nowMs, dueMs, cal);
  const warn = s.warnPercent > 0 && remainingMs <= (hours * HOUR_MS * s.warnPercent) / 100;
  return { state: warn ? "warn" : "ok", targetHours: hours, dueMs, remainingMs };
}

/** Task id → SLA, for every task the policy measures. Empty when SLA is off. */
export function computeSla(tasks: Task[], s: SlaSettings | null, nowMs: number): Map<string, SlaResult> {
  const out = new Map<string, SlaResult>();
  if (!s?.enabled) return out;
  const cal = makeCalendar(s);
  const targets = targetIndex(s);
  for (const t of tasks) {
    const r = slaFor(t, s, nowMs, cal, targets);
    if (r) out.set(t.id, r);
  }
  return out;
}

/** Ids in a given state — what the "Trễ SLA" filter and the report tiles count. */
export function slaIds(sla: Map<string, SlaResult>, state: SlaState): Set<string> {
  const ids = new Set<string>();
  for (const [id, r] of sla) if (r.state === state) ids.add(id);
  return ids;
}

/* --------------------------------------------------------------- wording */

export const SLA_STATE_LABEL: Record<SlaState, string> = {
  ok: "Trong hạn",
  warn: "Sắp trễ",
  breached: "Trễ SLA",
  met: "Xong đúng hạn",
  missed: "Xong trễ",
};

/**
 * Working time in words. A "ngày" is one working day of this calendar (8 giờ by
 * default), never 24 hours — the whole point of the clock. At most two units.
 */
export function formatWorkingDuration(ms: number, s: SlaSettings, compact = false): string {
  const dayMinutes = makeCalendar(s).dayMinutes || 480;
  let minutes = Math.round(Math.abs(ms) / 60_000);
  const days = Math.floor(minutes / dayMinutes);
  minutes -= days * dayMinutes;
  const hours = Math.floor(minutes / 60);
  minutes -= hours * 60;
  const parts: Array<[number, string, string]> = [
    [days, "n", " ngày"],
    [hours, "g", " giờ"],
    [minutes, "p", " phút"],
  ];
  const shown = parts.filter(([v]) => v > 0).slice(0, 2);
  if (shown.length === 0) return compact ? "0p" : "dưới 1 phút";
  return shown.map(([v, short, long]) => `${v}${compact ? short : long}`).join(compact ? "" : " ");
}

/** "31/10 15:00" — in the calendar's timezone; the year only when it is not this one. */
export function formatSlaInstant(ms: number, s: SlaSettings, nowMs: number): string {
  const tz = s.tzOffsetMinutes * 60_000;
  const d = new Date(ms + tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  const sameYear = d.getUTCFullYear() === new Date(nowMs + tz).getUTCFullYear();
  const date = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}${sameYear ? "" : `/${d.getUTCFullYear()}`}`;
  return `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** The chip text in the WBS column: state plus the time that matters for it. */
export function slaShortText(r: SlaResult, s: SlaSettings): string {
  const d = formatWorkingDuration(r.remainingMs, s, true);
  switch (r.state) {
    case "ok":
    case "warn":
      return `Còn ${d}`;
    case "breached":
      return `Trễ ${d}`;
    case "met":
      return "Đúng hạn";
    case "missed":
      return `Xong trễ ${d}`;
  }
}

/** The full sentence for the task window and tooltips. */
export function slaSentence(r: SlaResult, s: SlaSettings, nowMs: number): string {
  const due = formatSlaInstant(r.dueMs, s, nowMs);
  const d = formatWorkingDuration(r.remainingMs, s);
  const target = `mục tiêu ${formatWorkingDuration(r.targetHours * HOUR_MS, s)}`;
  switch (r.state) {
    case "ok":
    case "warn":
      return `Hạn ${due} · còn ${d} làm việc (${target})`;
    case "breached":
      return `Hạn ${due} · đã trễ ${d} làm việc (${target})`;
    case "met":
      return `Hạn ${due} · xong sớm hơn hạn ${d} làm việc`;
    case "missed":
      return `Hạn ${due} · xong trễ ${d} làm việc`;
  }
}

/** What a view needs to draw SLA: the policy (for wording), the computed map and the clock it used. Null when SLA is off. */
export interface SlaView {
  settings: SlaSettings;
  byId: Map<string, SlaResult>;
  nowMs: number;
}
