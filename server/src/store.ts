import { db, withTransaction } from "./db/pool.js";
import type { DependencyType, Predecessor } from "./types.js";

export interface TaskOverlay {
  startDate: string | null;
  durationDays: number;
  percentComplete: number;
  predecessors: Predecessor[];
  baselineStart: string | null;
  baselineDue: string | null;
}

export const defaultOverlay = (): TaskOverlay => ({
  startDate: null,
  durationDays: 1,
  percentComplete: 0,
  predecessors: [],
  baselineStart: null,
  baselineDue: null,
});

/**
 * Jira project keys are letters and digits with no hyphen, so everything before
 * the last hyphen of an issue key is the project. Stored on each row so one
 * project's schedule loads as a single indexed read.
 */
function projectKeyOf(issueKey: string): string {
  const sep = issueKey.lastIndexOf("-");
  return sep > 0 ? issueKey.slice(0, sep) : issueKey;
}

/** Overlay field -> column. The only source of column names, so no patch key can reach SQL. */
const COLUMNS = {
  startDate: "start_date",
  durationDays: "duration_days",
  percentComplete: "percent_complete",
  baselineStart: "baseline_start",
  baselineDue: "baseline_due",
} as const;

interface OverlayRow {
  issue_key: string;
  start_date: string | null;
  duration_days: number;
  percent_complete: number;
  baseline_start: string | null;
  baseline_due: string | null;
}

interface DependencyRow {
  successor_key: string;
  predecessor_key: string;
  type: DependencyType;
  lag_days: number;
}

function toOverlay(row: OverlayRow, predecessors: Predecessor[]): TaskOverlay {
  return {
    startDate: row.start_date,
    durationDays: row.duration_days,
    percentComplete: row.percent_complete,
    predecessors,
    baselineStart: row.baseline_start,
    baselineDue: row.baseline_due,
  };
}

export async function getOverlay(cloudId: string, issueKey: string): Promise<TaskOverlay> {
  const [overlay, deps] = await Promise.all([
    db().query<OverlayRow>(
      `SELECT issue_key, start_date, duration_days, percent_complete, baseline_start, baseline_due
         FROM task_overlay WHERE cloud_id = $1 AND issue_key = $2`,
      [cloudId, issueKey]
    ),
    db().query<DependencyRow>(
      `SELECT successor_key, predecessor_key, type, lag_days
         FROM task_dependency WHERE cloud_id = $1 AND successor_key = $2`,
      [cloudId, issueKey]
    ),
  ]);
  const predecessors = deps.rows.map((d) => ({
    taskId: d.predecessor_key,
    type: d.type,
    lagDays: d.lag_days,
  }));
  if (overlay.rows.length === 0) return { ...defaultOverlay(), predecessors };
  return toOverlay(overlay.rows[0], predecessors);
}

/**
 * Every overlay in one project, in two queries rather than one per task.
 *
 * The per-task read this replaces was fine against an in-memory JSON file but is
 * a network round trip per task against Postgres — on a 100-task project that is
 * 100 sequential round trips inside a single page load. Callers that need the
 * whole project (listTasks, the cascade's snapshot) use this instead.
 */
export async function getProjectOverlays(
  cloudId: string,
  projectKey: string
): Promise<Map<string, TaskOverlay>> {
  const [overlays, deps] = await Promise.all([
    db().query<OverlayRow>(
      `SELECT issue_key, start_date, duration_days, percent_complete, baseline_start, baseline_due
         FROM task_overlay WHERE cloud_id = $1 AND project_key = $2`,
      [cloudId, projectKey]
    ),
    db().query<DependencyRow>(
      `SELECT d.successor_key, d.predecessor_key, d.type, d.lag_days
         FROM task_dependency d
         JOIN task_overlay o ON o.cloud_id = d.cloud_id AND o.issue_key = d.successor_key
        WHERE d.cloud_id = $1 AND o.project_key = $2`,
      [cloudId, projectKey]
    ),
  ]);

  const predecessorsOf = new Map<string, Predecessor[]>();
  for (const d of deps.rows) {
    const list = predecessorsOf.get(d.successor_key) ?? [];
    list.push({ taskId: d.predecessor_key, type: d.type, lagDays: d.lag_days });
    predecessorsOf.set(d.successor_key, list);
  }

  const result = new Map<string, TaskOverlay>();
  for (const row of overlays.rows) {
    result.set(row.issue_key, toOverlay(row, predecessorsOf.get(row.issue_key) ?? []));
  }
  return result;
}

export async function setOverlay(
  cloudId: string,
  issueKey: string,
  patch: Partial<TaskOverlay>
): Promise<TaskOverlay> {
  await withTransaction(async (client) => {
    const columns: string[] = [];
    const values: unknown[] = [];
    for (const [field, column] of Object.entries(COLUMNS)) {
      const value = patch[field as keyof typeof COLUMNS];
      if (value !== undefined) {
        columns.push(column);
        values.push(value);
      }
    }

    // Always upsert the row, even for a predecessors-only patch: the dependency
    // rows below are joined back through task_overlay, so an edge whose successor
    // has no overlay row would be invisible to getProjectOverlays.
    //
    // Numbering is derived from `leading` rather than written as a literal
    // offset: hardcoding it put the first patch column on $3, which the three
    // fixed columns already occupy, so `project_key` (text) and `start_date`
    // (date) both resolved to $3 and Postgres refused the statement with
    // "inconsistent types deduced for parameter $3".
    const leading = [cloudId, issueKey, projectKeyOf(issueKey)];
    const placeholders = values.map((_, i) => `$${leading.length + i + 1}`);
    const assignments = columns.map((c) => `${c} = EXCLUDED.${c}`);
    await client.query(
      `INSERT INTO task_overlay (cloud_id, issue_key, project_key${columns.length ? ", " + columns.join(", ") : ""})
       VALUES ($1, $2, $3${placeholders.length ? ", " + placeholders.join(", ") : ""})
       ON CONFLICT (cloud_id, issue_key) DO UPDATE
         SET updated_at = now()${assignments.length ? ", " + assignments.join(", ") : ""}`,
      [...leading, ...values]
    );

    if (patch.predecessors !== undefined) {
      await client.query(`DELETE FROM task_dependency WHERE cloud_id = $1 AND successor_key = $2`, [
        cloudId,
        issueKey,
      ]);
      for (const p of patch.predecessors) {
        // A self-link is rejected by a CHECK constraint; skipping it here keeps a
        // malformed client payload from failing the whole schedule write.
        if (p.taskId === issueKey) continue;
        await client.query(
          `INSERT INTO task_dependency (cloud_id, successor_key, predecessor_key, type, lag_days)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (cloud_id, successor_key, predecessor_key, type)
             DO UPDATE SET lag_days = EXCLUDED.lag_days`,
          [cloudId, issueKey, p.taskId, p.type, p.lagDays]
        );
      }
    }
  });

  return getOverlay(cloudId, issueKey);
}

/**
 * Upserts many overlays in one round trip, each written in full — callers pass
 * the complete overlay they want stored, not a patch, so there is no way to
 * silently blank a column this caller didn't know about.
 *
 * Dependencies are deliberately untouched: the only caller is the read path's
 * reconciliation with Jira, which never changes the dependency graph.
 */
export async function setOverlays(
  cloudId: string,
  entries: Array<{ issueKey: string; overlay: TaskOverlay }>
): Promise<void> {
  if (entries.length === 0) return;

  const values: unknown[] = [];
  const rows = entries.map(({ issueKey, overlay }) => {
    values.push(
      cloudId,
      issueKey,
      projectKeyOf(issueKey),
      overlay.startDate,
      overlay.durationDays,
      overlay.percentComplete,
      overlay.baselineStart,
      overlay.baselineDue
    );
    const n = values.length;
    return `($${n - 7}, $${n - 6}, $${n - 5}, $${n - 4}, $${n - 3}, $${n - 2}, $${n - 1}, $${n})`;
  });

  await db().query(
    `INSERT INTO task_overlay
       (cloud_id, issue_key, project_key, start_date, duration_days, percent_complete, baseline_start, baseline_due)
     VALUES ${rows.join(", ")}
     ON CONFLICT (cloud_id, issue_key) DO UPDATE SET
       start_date       = EXCLUDED.start_date,
       duration_days    = EXCLUDED.duration_days,
       percent_complete = EXCLUDED.percent_complete,
       baseline_start   = EXCLUDED.baseline_start,
       baseline_due     = EXCLUDED.baseline_due,
       updated_at       = now()`,
    values
  );
}

/** Does anything list `issueKey` as a predecessor? An index lookup, not a scan. */
export async function hasSuccessors(cloudId: string, issueKey: string): Promise<boolean> {
  const { rowCount } = await db().query(
    `SELECT 1 FROM task_dependency WHERE cloud_id = $1 AND predecessor_key = $2 LIMIT 1`,
    [cloudId, issueKey]
  );
  return (rowCount ?? 0) > 0;
}

export async function deleteOverlay(cloudId: string, issueKey: string): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(`DELETE FROM task_overlay WHERE cloud_id = $1 AND issue_key = $2`, [
      cloudId,
      issueKey,
    ]);
    // Both directions: the deleted task's own predecessors, and every edge that
    // pointed at it. Scoped to this site — deleting ABC-1 here must not sever an
    // unrelated ABC-1 on another Atlassian site.
    await client.query(
      `DELETE FROM task_dependency
        WHERE cloud_id = $1 AND (successor_key = $2 OR predecessor_key = $2)`,
      [cloudId, issueKey]
    );
  });
}
