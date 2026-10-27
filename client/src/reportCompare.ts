import type { Health, ProgressReport } from "./types";

/**
 * Two saved AI reports side by side: what moved in the numbers, and which risks and
 * recommendations appeared or went away. Pure, so the rules (what counts as "the same risk",
 * which direction is an improvement) are testable.
 *
 * The figures compared are the metrics each report *stored* — a report keeps saying what it said
 * on its own day (see ai_progress_report) — so this is a comparison of two moments, never of one
 * moment against today's recomputation.
 */

export type Direction = "better" | "worse" | "same";

export interface MetricRow {
  key: string;
  label: string;
  a: number | null;
  b: number | null;
  /** b − a; null when either side has no value (SPI is null until the plan expects 10%). */
  delta: number | null;
  /** Whether a bigger number is an improvement. */
  higherIsBetter: boolean;
  direction: Direction;
  suffix: string;
}

export interface ListDiff {
  /** Only in the newer report. */
  added: string[];
  /** Only in the older report — gone, or at least no longer named. */
  resolved: string[];
  /** In both. */
  kept: string[];
}

export interface ReportComparison {
  older: ProgressReport;
  newer: ProgressReport;
  daysApart: number;
  health: { from: Health; to: Health; direction: Direction };
  metrics: MetricRow[];
  risks: ListDiff;
  recommendations: ListDiff;
}

const HEALTH_RANK: Record<Health, number> = { off_track: 0, at_risk: 1, on_track: 2 };

/** Same wording up to case, spacing, punctuation and diacritics — a model rephrases a title slightly between runs. */
export function foldText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function diffLists(older: string[], newer: string[]): ListDiff {
  const oldKeys = new Map(older.map((t) => [foldText(t), t]));
  const newKeys = new Map(newer.map((t) => [foldText(t), t]));
  return {
    added: [...newKeys].filter(([k]) => !oldKeys.has(k)).map(([, t]) => t),
    resolved: [...oldKeys].filter(([k]) => !newKeys.has(k)).map(([, t]) => t),
    kept: [...newKeys].filter(([k]) => oldKeys.has(k)).map(([, t]) => t),
  };
}

function row(key: string, label: string, a: number | null, b: number | null, higherIsBetter: boolean, suffix = ""): MetricRow {
  const delta = a === null || b === null ? null : Math.round((b - a) * 100) / 100;
  const direction: Direction = delta === null || delta === 0 ? "same" : delta > 0 === higherIsBetter ? "better" : "worse";
  return { key, label, a, b, delta, higherIsBetter, direction, suffix };
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000);

/** Orders the pair by the day each report is *about*, then by when it was written. */
export function orderPair(x: ProgressReport, y: ProgressReport): [ProgressReport, ProgressReport] {
  const key = (r: ProgressReport) => `${r.asOf}|${r.createdAt}`;
  return key(x) <= key(y) ? [x, y] : [y, x];
}

export function compareReports(x: ProgressReport, y: ProgressReport): ReportComparison {
  const [older, newer] = orderPair(x, y);
  const am = older.metrics;
  const bm = newer.metrics;
  const hd = HEALTH_RANK[newer.health] - HEALTH_RANK[older.health];
  return {
    older,
    newer,
    daysApart: daysBetween(older.asOf, newer.asOf),
    health: { from: older.health, to: newer.health, direction: hd === 0 ? "same" : hd > 0 ? "better" : "worse" },
    metrics: [
      row("actual", "Hoàn thành thực tế", older.actualPct, newer.actualPct, true, "%"),
      row("planned", "Kế hoạch (theo baseline)", older.plannedPct, newer.plannedPct, true, "%"),
      row("spi", "SPI", am.spi, bm.spi, true),
      row("done", "Việc đã xong", am.counts.done, bm.counts.done, true),
      row("inProgress", "Đang làm", am.counts.inProgress, bm.counts.inProgress, true),
      row("overdue", "Quá hạn", am.counts.overdue, bm.counts.overdue, false),
      row("slipped", "Trễ baseline", am.counts.slipped, bm.counts.slipped, false),
      row("notStarted", "Tới ngày chưa bắt đầu", am.counts.notStarted, bm.counts.notStarted, false),
      row("unassigned", "Chưa gán người", am.counts.unassigned, bm.counts.unassigned, false),
      row("criticalOpen", "Việc găng còn mở", am.counts.criticalOpen, bm.counts.criticalOpen, false),
    ],
    risks: diffLists(older.narrative.risks.map((r) => r.title), newer.narrative.risks.map((r) => r.title)),
    recommendations: diffLists(older.narrative.recommendations.map((r) => r.action), newer.narrative.recommendations.map((r) => r.action)),
  };
}
