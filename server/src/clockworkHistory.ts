/**
 * What I logged before the period on screen, folded to one line per issue: the strongest sign of what I will log
 * next. A backtest over two months of real worklogs (27 people, 9 projects) found that "logged on it in the last
 * ten working days" alone already holds most of what a person logs on a given day; everything else (assigned,
 * in progress, due soon) moved the hit rate by a few points. So Clockwork reads 30 days back and the browser
 * ranks rows and projects from this.
 */
import type { WorklogEntry } from "./timesheet.js";

export interface HistoryItem {
  key: string;
  summary: string;
  issueType: string;
  /** The last day I logged on it (local calendar date). */
  lastDate: string;
  /** On how many different days. */
  days: number;
  hours: number;
}

export const HISTORY_DAYS = 30;

export function summarizeHistory(entries: readonly WorklogEntry[]): HistoryItem[] {
  const by = new Map<string, { item: HistoryItem; dates: Set<string> }>();
  for (const e of entries) {
    if (!e.mine) continue;
    const cur = by.get(e.issueKey);
    if (!cur) {
      by.set(e.issueKey, {
        item: { key: e.issueKey, summary: e.summary, issueType: e.issueType, lastDate: e.date, days: 0, hours: e.hours },
        dates: new Set([e.date]),
      });
      continue;
    }
    cur.dates.add(e.date);
    cur.item.hours += e.hours;
    if (e.date > cur.item.lastDate) cur.item.lastDate = e.date;
  }
  return [...by.values()]
    .map(({ item, dates }) => ({ ...item, days: dates.size, hours: Math.round(item.hours * 100) / 100 }))
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate) || b.days - a.days || a.key.localeCompare(b.key, undefined, { numeric: true }));
}
