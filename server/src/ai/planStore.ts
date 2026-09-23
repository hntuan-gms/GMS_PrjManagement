import { db, withTransaction } from "../db/pool.js";
import type { Predecessor } from "../types.js";
import type { PlannedItem } from "./planner.js";

export type PlanStatus = "running" | "proposed" | "applied" | "failed" | "discarded";

export interface PlanRun {
  id: string;
  projectKey: string;
  status: PlanStatus;
  brief: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  error: string | null;
  createdAt: string;
  appliedAt: string | null;
}

export interface PlanItem extends PlannedItem {
  id: string;
  sortOrder: number;
  appliedIssueKey: string | null;
}

interface RunRow {
  id: string;
  project_key: string;
  status: PlanStatus;
  brief: string;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  error: string | null;
  created_at: Date;
  applied_at: Date | null;
}

interface ItemRow {
  id: string;
  temp_id: string;
  parent_temp_id: string | null;
  sort_order: number;
  summary: string;
  description: string | null;
  issue_type: string;
  duration_days: number;
  assignee_account_id: string | null;
  dependencies: Array<{ tempId: string; type: Predecessor["type"]; lagDays: number }>;
  rationale: string | null;
  applied_issue_key: string | null;
}

function toRun(row: RunRow): PlanRun {
  return {
    id: row.id,
    projectKey: row.project_key,
    status: row.status,
    brief: row.brief,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    error: row.error,
    createdAt: row.created_at.toISOString(),
    appliedAt: row.applied_at?.toISOString() ?? null,
  };
}

export async function createRun(
  cloudId: string,
  projectKey: string,
  createdBy: string,
  brief: string
): Promise<string> {
  const { rows } = await db().query<{ id: string }>(
    `INSERT INTO ai_plan_run (cloud_id, project_key, created_by, brief, status)
     VALUES ($1, $2, $3, $4, 'running') RETURNING id`,
    [cloudId, projectKey, createdBy, brief]
  );
  return rows[0].id;
}

export async function failRun(runId: string, message: string): Promise<void> {
  await db().query(`UPDATE ai_plan_run SET status = 'failed', error = $2 WHERE id = $1`, [
    runId,
    message.slice(0, 2000),
  ]);
}

/** Stores the model's proposal and flips the run to 'proposed' in one transaction. */
export async function saveProposal(
  runId: string,
  items: PlannedItem[],
  meta: { model: string; inputTokens: number | null; outputTokens: number | null; raw: unknown }
): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE ai_plan_run
          SET status = 'proposed', model = $2, input_tokens = $3, output_tokens = $4, raw_output = $5, error = NULL
        WHERE id = $1`,
      [runId, meta.model, meta.inputTokens, meta.outputTokens, JSON.stringify(meta.raw)]
    );
    // A re-run of the same plan replaces its items rather than appending to them.
    await client.query(`DELETE FROM ai_plan_item WHERE run_id = $1`, [runId]);
    for (const [index, item] of items.entries()) {
      await client.query(
        `INSERT INTO ai_plan_item
           (run_id, temp_id, parent_temp_id, sort_order, summary, description, issue_type,
            duration_days, assignee_account_id, dependencies, rationale)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          runId,
          item.tempId,
          item.parentTempId,
          index,
          item.summary,
          item.description,
          item.issueType,
          item.durationDays,
          item.assigneeAccountId,
          JSON.stringify(item.dependencies),
          item.rationale,
        ]
      );
    }
  });
}

/** Scoped by cloudId so a run id from another site can't be read or applied here. */
export async function getRun(cloudId: string, runId: string): Promise<PlanRun | null> {
  const { rows } = await db().query<RunRow>(
    `SELECT id, project_key, status, brief, model, input_tokens, output_tokens, error, created_at, applied_at
       FROM ai_plan_run WHERE cloud_id = $1 AND id = $2`,
    [cloudId, runId]
  );
  return rows.length > 0 ? toRun(rows[0]) : null;
}

export async function listItems(runId: string): Promise<Omit<PlanItem, "startDate" | "dueDate">[]> {
  const { rows } = await db().query<ItemRow>(
    `SELECT id, temp_id, parent_temp_id, sort_order, summary, description, issue_type,
            duration_days, assignee_account_id, dependencies, rationale, applied_issue_key
       FROM ai_plan_item WHERE run_id = $1 ORDER BY sort_order`,
    [runId]
  );
  return rows.map((r) => ({
    id: r.id,
    tempId: r.temp_id,
    parentTempId: r.parent_temp_id,
    sortOrder: r.sort_order,
    summary: r.summary,
    description: r.description,
    issueType: r.issue_type,
    durationDays: r.duration_days,
    assigneeAccountId: r.assignee_account_id,
    dependencies: r.dependencies ?? [],
    rationale: r.rationale,
    appliedIssueKey: r.applied_issue_key,
  }));
}

/** The reviewer's edits — only the fields it makes sense to change before applying. */
export async function updateItem(
  runId: string,
  itemId: string,
  patch: { summary?: string; durationDays?: number; assigneeAccountId?: string | null; issueType?: string }
): Promise<void> {
  const columns: Record<string, string> = {
    summary: "summary",
    durationDays: "duration_days",
    assigneeAccountId: "assignee_account_id",
    issueType: "issue_type",
  };
  const sets: string[] = [];
  const values: unknown[] = [runId, itemId];
  for (const [field, column] of Object.entries(columns)) {
    const value = patch[field as keyof typeof patch];
    if (value !== undefined) {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    }
  }
  if (sets.length === 0) return;
  await db().query(
    `UPDATE ai_plan_item SET ${sets.join(", ")} WHERE run_id = $1 AND id = $2 AND applied_issue_key IS NULL`,
    values
  );
}

export async function deleteItem(runId: string, itemId: string): Promise<void> {
  await db().query(
    `DELETE FROM ai_plan_item WHERE run_id = $1 AND id = $2 AND applied_issue_key IS NULL`,
    [runId, itemId]
  );
}

export async function markItemApplied(itemId: string, issueKey: string): Promise<void> {
  await db().query(`UPDATE ai_plan_item SET applied_issue_key = $2 WHERE id = $1`, [itemId, issueKey]);
}

export async function setRunStatus(runId: string, status: PlanStatus): Promise<void> {
  await db().query(
    `UPDATE ai_plan_run
        SET status = $2, applied_at = CASE WHEN $2 = 'applied' THEN now() ELSE applied_at END
      WHERE id = $1`,
    [runId, status]
  );
}

// The resource pool itself lives in ../resourceStore.ts: it is the AI planner's
// input here, but the Nguon luc tab's subject, and one table should not have two
// sets of accessors drifting apart.
