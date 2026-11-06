import { addDays } from "./resourceAllocation";
import { makeDate, weekdayDate } from "./quickAdd";

/**
 * What a date field accepts when typed (DateField): the app's own words, day-first always —
 * the browser's <input type="date"> showed "10/29/2026" on an English Chrome, beside the
 * app's "01/11/2026", and a Vietnamese reader takes "11/08" for 11 August (plan T2).
 *
 *   "15/11", "15/11/2026", "15-11-26", "hôm nay", "mai", "ngày kia", "t2"…"t7", "cn",
 *   "+3" / "+3n" (days from `base`, or today), "-2", "2026-11-15".
 *
 * Returns YYYY-MM-DD, "" for an empty box, or null when the text is not a date.
 */
export function parseDateInput(text: string, today: string, base?: string): string | null {
  const raw = text.trim().toLowerCase();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const fold = raw.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");
  if (fold === "hom nay" || fold === "nay") return today;
  if (fold === "mai") return addDays(today, 1);
  if (fold === "ngay kia" || fold === "mot") return addDays(today, 2);
  const rel = /^([+-])\s*(\d{1,3})\s*(n|ngay|d)?$/.exec(fold);
  if (rel) return addDays(base || today, (rel[1] === "-" ? -1 : 1) * Number(rel[2]));
  const wd = /^(t([2-7])|cn)(\s+tuan\s+sau)?$/.exec(fold);
  if (wd) return weekdayDate(wd[1] === "cn" ? 7 : Number(wd[2]) - 1, today, !!wd[3]);
  const dmy = /^(\d{1,2})[/.\-\s](\d{1,2})(?:[/.\-\s](\d{2}|\d{4}))?$/.exec(fold);
  if (dmy) {
    const y = dmy[3] ? (dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3])) : null;
    return makeDate(Number(dmy[1]), Number(dmy[2]), y, today);
  }
  return null;
}

/** "2026-11-15" → "15/11/2026" (the field's display form). */
export function formatDateInput(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "";
}
