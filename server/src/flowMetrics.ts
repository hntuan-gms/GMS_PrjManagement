/**
 * Flow metrics — cumulative flow, control chart, created-vs-resolved — computed from each issue's
 * created/resolved dates and status changelog.
 *
 * Pure: `flowReports.ts` fetches the issues, this file only does arithmetic, so the rules that
 * decide what a chart says are testable with hand-built histories.
 *
 * What each one measures, and what it does not:
 * - **Cumulative flow** replays every status change to say which status each issue was in at the
 *   end of each day. Work finished *before* the window is not in the data set, so the Done band
 *   starts at the window's own completions rather than the project's lifetime total.
 * - **Control chart** is time from first entering an "in progress" status to resolution (cycle
 *   time); where an issue never went through one, only lead time (created → resolved) exists.
 * - **Created vs resolved** is the plain count of each per day or week; no changelog needed.
 */

const DAY_MS = 86_400_000;

export type StatusCategory = "new" | "indeterminate" | "done";

export interface FlowStatus {
  id: string;
  name: string;
  category: StatusCategory;
}

export interface FlowIssue {
  key: string;
  created: number;
  resolved: number | null;
  /** The status it was created in (the first change's `from`, or its current one if it never changed). */
  initialStatusId: string;
  /** Status changes in time order. */
  transitions: Array<{ at: number; toId: string }>;
}

/** A search hit with `expand=changelog` → what the metrics need. Null when it has no usable created date. */
export function toFlowIssue(raw: any): FlowIssue | null {
  const f = raw?.fields ?? {};
  const created = Date.parse(f.created ?? "");
  if (!Number.isFinite(created)) return null;
  const changes: Array<{ at: number; from: string | null; to: string }> = [];
  for (const h of raw?.changelog?.histories ?? []) {
    const at = Date.parse(h?.created ?? "");
    if (!Number.isFinite(at)) continue;
    for (const item of h?.items ?? []) {
      if (item?.field !== "status" || item.to == null) continue;
      changes.push({ at, from: item.from == null ? null : String(item.from), to: String(item.to) });
    }
  }
  changes.sort((a, b) => a.at - b.at);
  const resolved = f.resolutiondate ? Date.parse(f.resolutiondate) : NaN;
  return {
    key: String(raw.key),
    created,
    resolved: Number.isFinite(resolved) ? resolved : null,
    initialStatusId: changes[0]?.from ?? String(f.status?.id ?? ""),
    transitions: changes.map((c) => ({ at: c.at, toId: c.to })),
  };
}

/* ------------------------------------------------------------------- dates */

/** UTC instant of local midnight at the start of `iso`. */
const startOfDayMs = (iso: string, tz: number) => Date.parse(iso + "T00:00:00Z") - tz * 60_000;
const endOfDayMs = (iso: string, tz: number) => startOfDayMs(iso, tz) + DAY_MS - 1;
const localDate = (ms: number, tz: number) => new Date(ms + tz * 60_000).toISOString().slice(0, 10);

export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(iso + "T00:00:00Z") + n * DAY_MS).toISOString().slice(0, 10);
}

export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The Monday on or before `iso`. */
export function weekStart(iso: string): string {
  const dow = new Date(iso + "T00:00:00Z").getUTCDay();
  return addDays(iso, -((dow + 6) % 7));
}

/* ----------------------------------------------------------- cumulative flow */

/** The status the issue was in at `atMs`, or null before it existed. */
export function statusAt(issue: FlowIssue, atMs: number): string | null {
  if (atMs < issue.created) return null;
  let status = issue.initialStatusId;
  for (const t of issue.transitions) {
    if (t.at > atMs) break;
    status = t.toId;
  }
  return status;
}

export interface CumulativeFlow {
  dates: string[];
  /** In workflow order (To Do first, Done last); a status nobody was ever in is left out. */
  series: Array<{ statusId: string; name: string; category: StatusCategory; counts: number[] }>;
}

export function cumulativeFlow(issues: FlowIssue[], statuses: FlowStatus[], dates: string[], tz: number): CumulativeFlow {
  const index = new Map(statuses.map((s, i) => [s.id, i]));
  const counts = new Map<string, number[]>();
  dates.forEach((d, di) => {
    const t = endOfDayMs(d, tz);
    for (const issue of issues) {
      const id = statusAt(issue, t);
      if (id === null) continue;
      const row = counts.get(id) ?? new Array(dates.length).fill(0);
      row[di] += 1;
      counts.set(id, row);
    }
  });
  const order: StatusCategory[] = ["new", "indeterminate", "done"];
  const known = (id: string) => statuses.find((s) => s.id === id);
  const series = [...counts]
    .map(([id, row]) => {
      const s = known(id);
      return { statusId: id, name: s?.name ?? id, category: s?.category ?? ("indeterminate" as StatusCategory), counts: row };
    })
    .sort(
      (a, b) =>
        order.indexOf(a.category) - order.indexOf(b.category) ||
        (index.get(a.statusId) ?? 999) - (index.get(b.statusId) ?? 999) ||
        a.name.localeCompare(b.name, "vi")
    );
  return { dates, series };
}

/* ------------------------------------------------------------ control chart */

export interface CyclePoint {
  key: string;
  /** Local date it was resolved. */
  date: string;
  leadDays: number;
  /** Null when the issue never entered an in-progress status. */
  cycleDays: number | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function cycleTimes(
  issues: FlowIssue[],
  statuses: FlowStatus[],
  from: string,
  to: string,
  tz: number
): CyclePoint[] {
  const category = new Map(statuses.map((s) => [s.id, s.category]));
  const out: CyclePoint[] = [];
  for (const issue of issues) {
    if (issue.resolved === null) continue;
    const date = localDate(issue.resolved, tz);
    if (date < from || date > to) continue;
    const started = issue.transitions.find((t) => category.get(t.toId) === "indeterminate")?.at ?? null;
    out.push({
      key: issue.key,
      date,
      leadDays: round1(Math.max(0, issue.resolved - issue.created) / DAY_MS),
      cycleDays: started === null ? null : round1(Math.max(0, issue.resolved - started) / DAY_MS),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key, undefined, { numeric: true }));
}

/** Nearest-rank percentile of an ascending list; null for an empty one. */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export interface ControlStats {
  count: number;
  mean: number;
  p50: number;
  p85: number;
  p95: number;
}

export function controlStats(values: number[]): ControlStats | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: values.length,
    mean: round1(values.reduce((s, v) => s + v, 0) / values.length),
    p50: percentile(sorted, 50)!,
    p85: percentile(sorted, 85)!,
    p95: percentile(sorted, 95)!,
  };
}

/** Mean of the last `window` values at each point — the moving line through the scatter. */
export function rollingMean(values: number[], window = 5): number[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1);
    return round1(slice.reduce((s, v) => s + v, 0) / slice.length);
  });
}

/* ------------------------------------------------------ created vs resolved */

export interface FlowBucket {
  /** First day of the bucket (the day itself, or the week's Monday). */
  start: string;
  created: number;
  resolved: number;
}

export function createdVsResolved(
  issues: FlowIssue[],
  from: string,
  to: string,
  tz: number,
  bucket: "day" | "week"
): FlowBucket[] {
  const key = (iso: string) => (bucket === "week" ? weekStart(iso) : iso);
  const map = new Map<string, FlowBucket>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const k = key(d);
    if (!map.has(k)) map.set(k, { start: k, created: 0, resolved: 0 });
  }
  for (const issue of issues) {
    const c = localDate(issue.created, tz);
    if (c >= from && c <= to) map.get(key(c))!.created += 1;
    if (issue.resolved !== null) {
      const r = localDate(issue.resolved, tz);
      if (r >= from && r <= to) map.get(key(r))!.resolved += 1;
    }
  }
  return [...map.values()].sort((a, b) => a.start.localeCompare(b.start));
}
