export type TimesheetMode = "week" | "month";

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const weekday = (iso: string) => new Date(iso + "T00:00:00Z").getUTCDay();

/** The week (Monday–Sunday) or calendar month the anchor day is in. */
export function rangeOf(mode: TimesheetMode, anchor: string): { from: string; to: string } {
  if (mode === "week") {
    const from = addDays(anchor, -((weekday(anchor) + 6) % 7));
    return { from, to: addDays(from, 6) };
  }
  const from = `${anchor.slice(0, 7)}-01`;
  const next = new Date(from + "T00:00:00Z");
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { from, to: addDays(next.toISOString().slice(0, 10), -1) };
}

export const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
export const WEEKDAYS_LONG = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];

/** "03/11" from "2026-11-03". */
export const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Every date from `from` to `to`, both included. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
