/** What one working day of effort is, in hours — the resource view's default capacity too. */
export const HOURS_PER_DAY = 8;

export const roundHours = (h: number) => Math.round(h * 100) / 100;

/**
 * Today in the browser's own calendar. `new Date().toISOString()` is UTC and
 * reads as yesterday in Vietnam until 07:00 (BUG-04).
 */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Last day of a task that starts on `start` (YYYY-MM-DD) and lasts `durationDays`:
 * due = start + ceil(duration) − 1, the server's rule, computed in UTC like it is.
 * Null when the start isn't a date, so a half-typed field shows no hint.
 */
/**
 * Whole days a task takes from `start` to `end`, both included — what typing an end date means. An end before
 * the start (or something unreadable) is one day: the task cannot end before it begins.
 */
export function durationBetween(start: string, end: string): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start);
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(end);
  if (!a || !b) return null;
  const days = Math.round((Date.UTC(+b[1], +b[2] - 1, +b[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3])) / 86_400_000) + 1;
  return Math.max(1, days);
}

export function endDateOf(start: string, durationDays: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start);
  if (!m || !Number.isFinite(durationDays)) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]) + (Math.max(1, Math.ceil(durationDays)) - 1) * 86_400_000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** "2026-11-04" → "04/11" (with the year when it isn't the start's own year). */
export function shortDate(iso: string, sameYearAs?: string): string {
  const [y, mo, d] = iso.split("-");
  return sameYearAs && sameYearAs.slice(0, 4) === y ? `${d}/${mo}` : `${d}/${mo}/${y}`;
}
