/*
 * A time of day typed by a person, kept as 24h "HH:mm". `<input type="time">` follows the operating
 * system's language ("08:00 AM"), so the app uses a text box and this parser instead.
 */

/** "8", "8h", "8:30", "0830", "20h", "8h30", "8.30" → "HH:mm"; null when it is not a time of day. */
export function parseTime(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  let h: number;
  let m: number;
  let match: RegExpMatchArray | null;
  if ((match = s.match(/^(\d{1,2})(?:[:h.](\d{1,2})?)?$/))) {
    // "8", "8h", "8:30", "8h30", "8.30", "8:" (the last two digits after a separator are minutes)
    h = Number(match[1]);
    m = match[2] === undefined ? 0 : match[2].length === 1 ? Number(match[2]) * 10 : Number(match[2]);
  } else if ((match = s.match(/^(\d{2})(\d{2})$/))) {
    h = Number(match[1]);
    m = Number(match[2]);
  } else if ((match = s.match(/^(\d)(\d{2})$/))) {
    // "830" → 08:30
    h = Number(match[1]);
    m = Number(match[2]);
  } else {
    return null;
  }
  if (h > 23 || m > 59) return null;
  return formatTime(h, m);
}

export function formatTime(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Minutes after midnight for a valid "HH:mm", else null. For comparing two times and measuring a period. */
export function timeToMinutes(hhmm: string): number | null {
  const m = hhmm.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
