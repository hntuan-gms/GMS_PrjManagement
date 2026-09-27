import { db } from "../db/pool.js";
import type { Health, ProgressMetrics } from "../progress.js";
import type { ReportNarrative, ReportUsage } from "./report.js";

export interface StoredReport {
  id: string;
  createdAt: string;
  createdBy: string;
  asOf: string;
  health: Health;
  actualPct: number;
  plannedPct: number;
  metrics: ProgressMetrics;
  narrative: ReportNarrative;
  model: string | null;
  usage: ReportUsage;
}

/** One point on the trend line — the columns, without the heavy JSON. */
export interface ReportPoint {
  id: string;
  createdAt: string;
  asOf: string;
  health: Health;
  actualPct: number;
  plannedPct: number;
  headline: string;
}

interface Row {
  id: string;
  created_at: Date;
  created_by: string;
  as_of: string;
  health: Health;
  actual_pct: string;
  planned_pct: string;
  metrics: ProgressMetrics;
  narrative: ReportNarrative;
  model: string | null;
  prompt_tokens: number | null;
  output_tokens: number | null;
  thought_tokens: number | null;
  cached_tokens: number | null;
}

function toReport(r: Row): StoredReport {
  return {
    id: r.id,
    createdAt: r.created_at.toISOString(),
    createdBy: r.created_by,
    asOf: r.as_of,
    health: r.health,
    // numeric comes back as a string from node-postgres.
    actualPct: Number(r.actual_pct),
    plannedPct: Number(r.planned_pct),
    metrics: r.metrics,
    narrative: r.narrative,
    model: r.model,
    usage: {
      promptTokens: r.prompt_tokens,
      outputTokens: r.output_tokens,
      thoughtTokens: r.thought_tokens,
      cachedTokens: r.cached_tokens,
    },
  };
}

export async function saveReport(input: {
  cloudId: string;
  projectKey: string;
  createdBy: string;
  metrics: ProgressMetrics;
  narrative: ReportNarrative;
  model: string;
  usage: ReportUsage;
}): Promise<StoredReport> {
  const { rows } = await db().query<Row>(
    `INSERT INTO ai_progress_report
       (cloud_id, project_key, created_by, as_of, health, actual_pct, planned_pct,
        metrics, narrative, model, prompt_tokens, output_tokens, thought_tokens, cached_tokens)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [
      input.cloudId,
      input.projectKey,
      input.createdBy,
      input.metrics.asOf,
      input.metrics.health,
      input.metrics.actualPct,
      input.metrics.plannedPct,
      JSON.stringify(input.metrics),
      JSON.stringify(input.narrative),
      input.model,
      input.usage.promptTokens,
      input.usage.outputTokens,
      input.usage.thoughtTokens,
      input.usage.cachedTokens,
    ]
  );
  return toReport(rows[0]);
}

export async function latestReport(cloudId: string, projectKey: string): Promise<StoredReport | null> {
  const { rows } = await db().query<Row>(
    `SELECT * FROM ai_progress_report
      WHERE cloud_id = $1 AND project_key = $2
      ORDER BY created_at DESC LIMIT 1`,
    [cloudId, projectKey]
  );
  return rows.length > 0 ? toReport(rows[0]) : null;
}

/** Scoped by cloud and project, so an id from another project can't be read here. */
export async function getReport(cloudId: string, projectKey: string, id: string): Promise<StoredReport | null> {
  const { rows } = await db().query<Row>(
    `SELECT * FROM ai_progress_report WHERE cloud_id = $1 AND project_key = $2 AND id = $3`,
    [cloudId, projectKey, id]
  );
  return rows.length > 0 ? toReport(rows[0]) : null;
}

/** Oldest first — the order a trend line is drawn in. */
export async function reportHistory(cloudId: string, projectKey: string, limit = 30): Promise<ReportPoint[]> {
  const { rows } = await db().query<{
    id: string;
    created_at: Date;
    as_of: string;
    health: Health;
    actual_pct: string;
    planned_pct: string;
    headline: string | null;
  }>(
    `SELECT id, created_at, as_of, health, actual_pct, planned_pct, narrative->>'headline' AS headline
       FROM (SELECT * FROM ai_progress_report
              WHERE cloud_id = $1 AND project_key = $2
              ORDER BY created_at DESC LIMIT $3) recent
      ORDER BY created_at ASC`,
    [cloudId, projectKey, limit]
  );
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at.toISOString(),
    asOf: r.as_of,
    health: r.health,
    actualPct: Number(r.actual_pct),
    plannedPct: Number(r.planned_pct),
    headline: r.headline ?? "",
  }));
}
