import { isoWeekday } from "./workCalendar";

/*
 * Pure helpers for the "Lịch làm việc & ngày lễ" dialog (WorkCalendarModal) and the SLA dialog's summary line.
 * Storage keeps one entry per date (server/src/sla.ts); people think in ranges ("Tết 14/02–20/02"), so the
 * dialog takes a range in and shows ranges out, and this file is the translation both ways.
 */

export type DatedEntry = { date: string; name: string };

/** ISO weekday → short Vietnamese label, Monday first. */
export const WEEKDAY_LABELS: Array<[number, string]> = [
  [1, "T2"],
  [2, "T3"],
  [3, "T4"],
  [4, "T5"],
  [5, "T6"],
  [6, "T7"],
  [7, "CN"],
];

/** Longest holiday a single "Thêm" may add — a guard against a typo in the year, not a rule about holidays. */
export const MAX_RANGE_DAYS = 31;

const label = (d: number) => WEEKDAY_LABELS.find(([n]) => n === d)?.[1] ?? String(d);

/** [1,2,3,4,5] → "T2–T6"; [1,3,5] → "T2, T4, T6"; [1..6] → "T2–T7". */
export function describeWorkDays(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 0) return "không có";
  const runs: Array<[number, number]> = [];
  for (const d of sorted) {
    const last = runs[runs.length - 1];
    if (last && d === last[1] + 1) last[1] = d;
    else runs.push([d, d]);
  }
  return runs.map(([a, b]) => (a === b ? label(a) : b === a + 1 ? `${label(a)}, ${label(b)}` : `${label(a)}–${label(b)}`)).join(", ");
}

export function addDaysIso(iso: string, n: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Every date from `from` to `to` (both included) carrying `name`, or an error sentence to show beside the form. */
export function expandRange(from: string, to: string, name: string): DatedEntry[] | { error: string } {
  if (!from) return { error: "Chọn ngày bắt đầu." };
  const end = to || from;
  if (end < from) return { error: "Ngày kết thúc phải sau ngày bắt đầu." };
  const out: DatedEntry[] = [];
  for (let d = from; d <= end; d = addDaysIso(d, 1)) {
    out.push({ date: d, name: name.trim() });
    if (out.length > MAX_RANGE_DAYS) return { error: `Một lần thêm tối đa ${MAX_RANGE_DAYS} ngày.` };
  }
  return out;
}

/** `added` over `list`: a date already there takes the new name. Sorted by date. */
export function mergeDated(list: DatedEntry[], added: DatedEntry[]): DatedEntry[] {
  const byDate = new Map(list.map((e) => [e.date, e]));
  for (const e of added) byDate.set(e.date, e);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export interface DatedGroup {
  from: string;
  to: string;
  name: string;
  dates: string[];
}

/** Consecutive dates with the same name become one row: "Tết Nguyên đán 14/02–20/02/2027 (7 ngày)". */
export function groupDated(list: DatedEntry[]): DatedGroup[] {
  const groups: DatedGroup[] = [];
  for (const e of [...list].sort((a, b) => a.date.localeCompare(b.date))) {
    const last = groups[groups.length - 1];
    if (last && last.name === e.name && addDaysIso(last.to, 1) === e.date) {
      last.to = e.date;
      last.dates.push(e.date);
    } else groups.push({ from: e.date, to: e.date, name: e.name, dates: [e.date] });
  }
  return groups;
}

/** "14/02/2027", or "14/02–20/02/2027", or "30/12/2026–02/01/2027" across a year. */
export function formatRange(from: string, to: string): string {
  const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  if (from === to) return `${dm(from)}/${from.slice(0, 4)}`;
  if (from.slice(0, 4) === to.slice(0, 4)) return `${dm(from)}–${dm(to)}/${to.slice(0, 4)}`;
  return `${dm(from)}/${from.slice(0, 4)}–${dm(to)}/${to.slice(0, 4)}`;
}

/** Why a make-up day would change nothing, or null when it is a real one. */
export function makeUpDayWarning(date: string, workDays: number[], holidays: DatedEntry[]): string | null {
  if (!date) return null;
  if (holidays.some((h) => h.date === date)) return "Ngày này đang là ngày lễ — xoá ngày lễ trước nếu muốn làm bù.";
  if (workDays.includes(isoWeekday(date))) return "Ngày này vốn đã là ngày làm việc, không cần đánh dấu làm bù.";
  return null;
}
