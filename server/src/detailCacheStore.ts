/** The Postgres side of detailCache.ts: project lists, and one issue's comments and attachments. */
import { db } from "./db/pool.js";
import { pgIssueCache } from "./issueCacheStore.js";
import type { DetailRow, DetailStore, IssueCopy } from "./detailCache.js";

const ms = (d: Date | null | undefined): number | null => (d ? d.getTime() : null);

export const pgDetailStore: DetailStore = {
  async getList(cloudId, projectKey, kind) {
    const res = await db().query<{ items: unknown; fetched_at: Date }>(
      `SELECT items, fetched_at FROM project_list_cache WHERE cloud_id = $1 AND project_key = $2 AND kind = $3`,
      [cloudId, projectKey, kind]
    );
    const r = res.rows[0];
    return r ? { items: r.items, fetchedAtMs: r.fetched_at.getTime() } : null;
  },

  async putList(cloudId, projectKey, kind, items) {
    await db().query(
      `INSERT INTO project_list_cache (cloud_id, project_key, kind, items, fetched_at)
       VALUES ($1, $2, $3, $4::jsonb, now())
       ON CONFLICT (cloud_id, project_key, kind) DO UPDATE SET items = EXCLUDED.items, fetched_at = now()`,
      [cloudId, projectKey, kind, JSON.stringify(items)]
    );
  },

  async getIssueCopy(cloudId, projectKey, key) {
    const res = await db().query<{ issue_id: string; description: unknown; secured: boolean; stale_at: Date | null; jira_updated: Date | null }>(
      `SELECT issue_id, description, secured, stale_at, jira_updated
         FROM jira_issue_cache WHERE cloud_id = $1 AND project_key = $2 AND issue_key = $3`,
      [cloudId, projectKey, key]
    );
    const r = res.rows[0];
    if (!r) return null;
    return {
      issueId: r.issue_id,
      description: r.description ?? null,
      secured: r.secured,
      staleAtMs: ms(r.stale_at),
      updatedMs: ms(r.jira_updated),
    } satisfies IssueCopy;
  },

  getVisibility: (cloudId, projectKey, accountId) => pgIssueCache.loadVisibility(cloudId, projectKey, accountId),

  async getSync(cloudId, projectKey) {
    const res = await db().query<{ last_delta_at: Date | null; changed_at: Date | null }>(
      `SELECT last_delta_at, changed_at FROM jira_project_sync WHERE cloud_id = $1 AND project_key = $2`,
      [cloudId, projectKey]
    );
    return { lastDeltaMs: ms(res.rows[0]?.last_delta_at), changedMs: ms(res.rows[0]?.changed_at) };
  },

  async writeBackDescription(cloudId, issueId, description) {
    await db().query(
      `UPDATE jira_issue_cache SET description = $3::jsonb WHERE cloud_id = $1 AND issue_id = $2 AND stale_at IS NULL`,
      [cloudId, issueId, JSON.stringify(description ?? null)]
    );
  },

  async getDetail(cloudId, issueId, kind) {
    const res = await db().query<{ data: unknown; restricted: boolean; issue_updated: Date | null; fetched_at: Date }>(
      `SELECT data, restricted, issue_updated, fetched_at FROM issue_detail_cache WHERE cloud_id = $1 AND issue_id = $2 AND kind = $3`,
      [cloudId, issueId, kind]
    );
    const r = res.rows[0];
    return r
      ? ({ data: r.data, restricted: r.restricted, issueUpdatedMs: ms(r.issue_updated), fetchedAtMs: r.fetched_at.getTime() } satisfies DetailRow)
      : null;
  },

  async putDetail(cloudId, issueId, kind, data, restricted, issueUpdatedMs) {
    await db().query(
      `INSERT INTO issue_detail_cache (cloud_id, issue_id, kind, data, restricted, issue_updated, fetched_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, now())
       ON CONFLICT (cloud_id, issue_id, kind)
       DO UPDATE SET data = EXCLUDED.data, restricted = EXCLUDED.restricted, issue_updated = EXCLUDED.issue_updated, fetched_at = now()`,
      [cloudId, issueId, kind, JSON.stringify(data), restricted, issueUpdatedMs === null ? null : new Date(issueUpdatedMs).toISOString()]
    );
  },

  async dropDetail(cloudId, issueKey, kinds) {
    await db().query(
      `DELETE FROM issue_detail_cache d
        USING jira_issue_cache c
        WHERE d.cloud_id = $1 AND c.cloud_id = d.cloud_id AND c.issue_id = d.issue_id
          AND c.issue_key = $2 AND d.kind = ANY($3)`,
      [cloudId, issueKey, kinds]
    );
  },
};
