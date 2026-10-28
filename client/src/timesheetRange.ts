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
