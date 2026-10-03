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
