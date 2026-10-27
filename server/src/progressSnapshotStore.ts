import { db } from "./db/pool.js";
import type { ProgressMetrics } from "./progress.js";

/**
 * One row of measured progress per project per day (migration 011) — the trend chart that does
 * not need an AI report. Keyed by cloudId like every other table.
 */

export interface SnapshotPoint {
  date: string;
  actualPct: number;
  plannedPct: number;
  spi: number | null;
  health: ProgressMetrics["health"];
  total: number;
  done: number;
  inProgress: number;
  overdue: number;
}

/** A visit refreshes today's row only when it is older than this, so page views are not writes. */
const REFRESH_AFTER = "3 hours";
const KEEP_DAYS = 365;

interface Row {
  snap_date: string;
  actual_pct: string | number;
  planned_pct: string | number;
  spi: string | number | null;
  health: SnapshotPoint["health"];
  total: number;
  done: number;
  in_progress: number;
  overdue: number;
}

/**
 * Record `metrics` as the day's snapshot. The caller decides *whether* it may: only an unscoped
 * view of (about) today is a project-wide snapshot — a view narrowed to one person, or an `asOf`
 * in the past, would otherwise overwrite the real figure with a partial one.
 */
export async function recordSnapshot(cloudId: string, projectKey: string, metrics: ProgressMetrics): Promise<void> {
  await db().query(
    `INSERT INTO progress_snapshot
       (cloud_id, project_key, snap_date, actual_pct, planned_pct, spi, health, total, done, in_progress, overdue)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (cloud_id, project_key, snap_date) DO UPDATE SET
       actual_pct = EXCLUDED.actual_pct, planned_pct = EXCLUDED.planned_pct, spi = EXCLUDED.spi,
       health = EXCLUDED.health, total = EXCLUDED.total, done = EXCLUDED.done,
       in_progress = EXCLUDED.in_progress, overdue = EXCLUDED.overdue, recorded_at = now()
     WHERE progress_snapshot.recorded_at < now() - interval '${REFRESH_AFTER}'`,
    [
      cloudId,
      projectKey,
      metrics.asOf,
      metrics.actualPct,
      metrics.plannedPct,
      metrics.spi,
      metrics.health,
      metrics.counts.total,
      metrics.counts.done,
      metrics.counts.inProgress,
      metrics.counts.overdue,
    ]
  );
}

export async function listSnapshots(cloudId: string, projectKey: string, days = KEEP_DAYS): Promise<SnapshotPoint[]> {
  const { rows } = await db().query<Row>(
    `SELECT snap_date, actual_pct, planned_pct, spi, health, total, done, in_progress, overdue
       FROM progress_snapshot
      WHERE cloud_id = $1 AND project_key = $2 AND snap_date >= (current_date - $3::int)
      ORDER BY snap_date`,
    [cloudId, projectKey, days]
  );
  return rows.map((r) => ({
    date: r.snap_date,
    actualPct: Number(r.actual_pct),
    plannedPct: Number(r.planned_pct),
    spi: r.spi === null ? null : Number(r.spi),
    health: r.health,
    total: r.total,
    done: r.done,
    inProgress: r.in_progress,
    overdue: r.overdue,
  }));
}

/**
 * May this request's figures be stored as the project's snapshot? Unscoped, and dated within a day
 * of the server's today (the browser's local date can be a day off UTC) — a made-up `asOf` cannot
 * plant a point in the past or the future.
 */
export function isSnapshotWorthy(asOf: string, scoped: boolean, nowMs = Date.now()): boolean {
  if (scoped) return false;
  const t = Date.parse(asOf + "T00:00:00Z");
  return Number.isFinite(t) && Math.abs(t - nowMs) <= 36 * 3_600_000;
}
