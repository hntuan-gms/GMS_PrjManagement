import { db } from "./db/pool.js";
import { badRequest } from "./errors.js";
import type { SavedFilterInput, SavedFilterSpec } from "./savedFilters.js";

export interface SavedFilter {
  id: string;
  name: string;
  shared: boolean;
  spec: SavedFilterSpec;
  createdBy: string;
  /** The caller created it — only then may they change or delete it. */
  mine: boolean;
  updatedAt: string;
}

interface Row {
  id: string;
  name: string;
  shared: boolean;
  spec: SavedFilterSpec;
  created_by: string;
  updated_at: Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Far above any real use; it only stops a script from filling the table.
const MAX_PER_OWNER = 100;

const toFilter = (r: Row, accountId: string): SavedFilter => ({
  id: r.id,
  name: r.name,
  shared: r.shared,
  spec: r.spec,
  createdBy: r.created_by,
  mine: r.created_by === accountId,
  updatedAt: r.updated_at.toISOString(),
});

/** The caller's own filters plus everyone's shared ones in this project; own first, then by name. */
export async function listFilters(cloudId: string, projectKey: string, accountId: string): Promise<SavedFilter[]> {
  const { rows } = await db().query<Row>(
    `SELECT id, name, shared, spec, created_by, updated_at
       FROM saved_filter
      WHERE cloud_id = $1 AND project_key = $2 AND (created_by = $3 OR shared)
      ORDER BY (created_by = $3) DESC, lower(name)`,
    [cloudId, projectKey, accountId]
  );
  return rows.map((r) => toFilter(r, accountId));
}

export async function createFilter(
  cloudId: string,
  projectKey: string,
  accountId: string,
  input: Required<SavedFilterInput>
): Promise<SavedFilter> {
  const { rows: count } = await db().query<{ n: string }>(
    `SELECT count(*)::text AS n FROM saved_filter WHERE cloud_id = $1 AND project_key = $2 AND created_by = $3`,
    [cloudId, projectKey, accountId]
  );
  if (Number(count[0]?.n ?? 0) >= MAX_PER_OWNER) {
    throw badRequest(`Mỗi người lưu tối đa ${MAX_PER_OWNER} bộ lọc trong một dự án — hãy xoá bớt bộ lọc cũ.`);
  }
  const { rows } = await db().query<Row>(
    `INSERT INTO saved_filter (cloud_id, project_key, name, spec, shared, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, shared, spec, created_by, updated_at`,
    [cloudId, projectKey, input.name, JSON.stringify(input.spec), input.shared, accountId]
  );
  return toFilter(rows[0], accountId);
}

/**
 * Only the creator's own row matches, so someone else's shared filter comes back
 * as "not found" — the same answer as a filter that doesn't exist, which tells a
 * guesser nothing. A malformed id is "not found" rather than a Postgres cast error.
 */
export async function updateFilter(
  cloudId: string,
  projectKey: string,
  accountId: string,
  id: string,
  input: SavedFilterInput
): Promise<SavedFilter | null> {
  if (!UUID.test(id)) return null;
  const { rows } = await db().query<Row>(
    `UPDATE saved_filter
        SET name = COALESCE($5, name),
            shared = COALESCE($6, shared),
            spec = COALESCE($7::jsonb, spec),
            updated_at = now()
      WHERE id = $1 AND cloud_id = $2 AND project_key = $3 AND created_by = $4
      RETURNING id, name, shared, spec, created_by, updated_at`,
    [
      id,
      cloudId,
      projectKey,
      accountId,
      input.name ?? null,
      input.shared ?? null,
      input.spec ? JSON.stringify(input.spec) : null,
    ]
  );
  return rows[0] ? toFilter(rows[0], accountId) : null;
}

/** A hard delete: unlike chat sessions and reports, a filter carries no spend ledger worth keeping. */
export async function deleteFilter(cloudId: string, projectKey: string, accountId: string, id: string): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const { rowCount } = await db().query(
    `DELETE FROM saved_filter WHERE id = $1 AND cloud_id = $2 AND project_key = $3 AND created_by = $4`,
    [id, cloudId, projectKey, accountId]
  );
  return (rowCount ?? 0) > 0;
}
