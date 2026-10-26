import { db } from "./db/pool.js";
import { badRequest } from "./errors.js";

/**
 * Saved Gantt filters. The `spec` is the toolbar's TaskFilter in a storable shape;
 * this module cleans it and keeps it, and has no idea what a facet means.
 */

export interface SavedFilterSpec {
  text: string;
  /** Account ids, or "@me" for whoever opens the filter — see client/src/savedFilter.ts. */
  people: string[];
  statuses: string[];
  types: string[];
  epics: string[];
  labels: string[];
  components: string[];
  versions: string[];
  sprints: string[];
  onlyOverdue: boolean;
  /** Passed to Jira as typed; empty = none. */
  jql: string;
}

export interface SavedFilter {
  id: string;
  name: string;
  shared: boolean;
  /** Written by the signed-in user: the only ones they can change or delete. */
  mine: boolean;
  ownerName: string;
  spec: SavedFilterSpec;
  updatedAt: string;
}

export const MAX_PER_OWNER = 50;
const MAX_ITEMS = 100;
const MAX_ITEM_CHARS = 200;
const MAX_JQL_CHARS = 2000;
const MAX_NAME_CHARS = 80;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function strings(v: unknown, field: string): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw badRequest(`Bộ lọc: "${field}" phải là danh sách chuỗi.`);
  if (v.length > MAX_ITEMS) throw badRequest(`Bộ lọc: "${field}" có quá nhiều mục.`);
  return [...new Set(v.map((x: string) => x.trim().slice(0, MAX_ITEM_CHARS)).filter(Boolean))];
}

/** Whatever the browser sent → a spec of exactly the right shape, or a 400. Unknown keys are dropped. */
export function sanitizeSpec(raw: unknown): SavedFilterSpec {
  if (!raw || typeof raw !== "object") throw badRequest("Bộ lọc không hợp lệ.");
  const r = raw as Record<string, unknown>;
  const text = typeof r.text === "string" ? r.text.trim().slice(0, MAX_ITEM_CHARS) : "";
  const jql = typeof r.jql === "string" ? r.jql.trim() : "";
  if (jql.length > MAX_JQL_CHARS) throw badRequest(`JQL quá dài (tối đa ${MAX_JQL_CHARS} ký tự).`);
  const spec: SavedFilterSpec = {
    text,
    people: strings(r.people, "people"),
    statuses: strings(r.statuses, "statuses"),
    types: strings(r.types, "types"),
    epics: strings(r.epics, "epics"),
    labels: strings(r.labels, "labels"),
    components: strings(r.components, "components"),
    versions: strings(r.versions, "versions"),
    sprints: strings(r.sprints, "sprints"),
    onlyOverdue: r.onlyOverdue === true,
    jql,
  };
  const empty =
    !spec.text && !spec.jql && !spec.onlyOverdue && [spec.people, spec.statuses, spec.types, spec.epics, spec.labels, spec.components, spec.versions, spec.sprints].every((a) => a.length === 0);
  if (empty) throw badRequest("Chưa có điều kiện lọc nào để lưu.");
  return spec;
}

export function cleanName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!name) throw badRequest("Cần đặt tên cho bộ lọc.");
  return name.slice(0, MAX_NAME_CHARS);
}

interface Row {
  id: string;
  name: string;
  shared: boolean;
  created_by: string;
  created_by_name: string;
  spec: SavedFilterSpec;
  updated_at: Date;
}

const toFilter = (r: Row, me: string): SavedFilter => ({
  id: r.id,
  name: r.name,
  shared: r.shared,
  mine: r.created_by === me,
  ownerName: r.created_by_name,
  spec: r.spec,
  updatedAt: r.updated_at.toISOString(),
});

/** Everything this person may see in this project: their own, and everyone's shared ones. */
export async function listFilters(cloudId: string, projectKey: string, accountId: string): Promise<SavedFilter[]> {
  const { rows } = await db().query<Row>(
    `SELECT id, name, shared, created_by, created_by_name, spec, updated_at
       FROM saved_filter
      WHERE cloud_id = $1 AND project_key = $2 AND (shared OR created_by = $3)
      ORDER BY lower(name), updated_at DESC`,
    [cloudId, projectKey, accountId]
  );
  return rows.map((r) => toFilter(r, accountId));
}

/**
 * Saving under a name the owner already used replaces that filter: two filters
 * with the same name in one list are indistinguishable, and "save again with a
 * tweak" is how people update one.
 */
export async function saveFilter(
  who: { cloudId: string; projectKey: string; accountId: string; displayName: string },
  input: { name: unknown; spec: unknown; shared: unknown }
): Promise<SavedFilter> {
  const name = cleanName(input.name);
  const spec = sanitizeSpec(input.spec);
  const shared = input.shared !== false;

  const existing = await db().query<{ id: string }>(
    `SELECT id FROM saved_filter
      WHERE cloud_id = $1 AND project_key = $2 AND created_by = $3 AND lower(name) = lower($4)`,
    [who.cloudId, who.projectKey, who.accountId, name]
  );
  if (existing.rows[0]) {
    const { rows } = await db().query<Row>(
      `UPDATE saved_filter SET name = $2, spec = $3, shared = $4, created_by_name = $5, updated_at = now()
        WHERE id = $1
        RETURNING id, name, shared, created_by, created_by_name, spec, updated_at`,
      [existing.rows[0].id, name, JSON.stringify(spec), shared, who.displayName]
    );
    return toFilter(rows[0], who.accountId);
  }

  const count = await db().query<{ n: string }>(
    `SELECT count(*)::text AS n FROM saved_filter WHERE cloud_id = $1 AND project_key = $2 AND created_by = $3`,
    [who.cloudId, who.projectKey, who.accountId]
  );
  if (Number(count.rows[0]?.n ?? 0) >= MAX_PER_OWNER) {
    throw badRequest(`Mỗi người chỉ lưu tối đa ${MAX_PER_OWNER} bộ lọc trong một dự án; hãy xoá bớt.`);
  }
  const { rows } = await db().query<Row>(
    `INSERT INTO saved_filter (cloud_id, project_key, name, spec, shared, created_by, created_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, name, shared, created_by, created_by_name, spec, updated_at`,
    [who.cloudId, who.projectKey, name, JSON.stringify(spec), shared, who.accountId, who.displayName]
  );
  return toFilter(rows[0], who.accountId);
}

/** Owner only. A malformed id is "not yours", not a Postgres cast error. */
export async function deleteFilter(cloudId: string, projectKey: string, accountId: string, id: string): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const { rowCount } = await db().query(
    `DELETE FROM saved_filter WHERE id = $1 AND cloud_id = $2 AND project_key = $3 AND created_by = $4`,
    [id, cloudId, projectKey, accountId]
  );
  return (rowCount ?? 0) > 0;
}

/** Owner only: share / unshare. */
export async function setShared(cloudId: string, projectKey: string, accountId: string, id: string, shared: boolean): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const { rowCount } = await db().query(
    `UPDATE saved_filter SET shared = $5, updated_at = now()
      WHERE id = $1 AND cloud_id = $2 AND project_key = $3 AND created_by = $4`,
    [id, cloudId, projectKey, accountId, shared]
  );
  return (rowCount ?? 0) > 0;
}
