/**
 * The Postgres side of issueCache.ts: the copy of each project's issues, the "changed since"
 * mark, each user's visible ids, and what a Jira write does to them. The replace rule in the
 * upsert is `shouldReplace` written in SQL — change both together.
 */
import { db } from "./db/pool.js";
import {
  isEmptyEffect,
  jiraTimeMs,
  writeEffect,
  type CachedIssue,
  type IssueCacheStore,
  type SyncState,
  type Visibility,
} from "./issueCache.js";

/** Rows per INSERT: a few MB of JSON at most, with descriptions. */
const UPSERT_CHUNK = 500;
/** How long a fill waits for another instance's fill of the same project before going ahead anyway. */
const FILL_LOCK_WAIT_MS = 120_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ms = (d: Date | null): number | null => (d ? d.getTime() : null);

interface CacheRow {
  issue_id: string;
  issue: any;
  description?: any;
  fields_sig: string;
  secured: boolean;
  jira_updated: Date | null;
  stale_at: Date | null;
  synced_at: Date;
}

export const pgIssueCache: IssueCacheStore = {
  async load(cloudId, projectKey, withDescription) {
    const [cached, sync] = await Promise.all([
      db().query<CacheRow>(
        `SELECT issue_id, issue, ${withDescription ? "description," : ""} fields_sig, secured, jira_updated, stale_at, synced_at
           FROM jira_issue_cache WHERE cloud_id = $1 AND project_key = $2`,
        [cloudId, projectKey]
      ),
      db().query<{ delta_from: Date | null; last_delta_at: Date | null; extra_fields: string[] | null; changed_at: Date | null }>(
        `SELECT delta_from, last_delta_at, extra_fields, changed_at FROM jira_project_sync WHERE cloud_id = $1 AND project_key = $2`,
        [cloudId, projectKey]
      ),
    ]);
    const rows = new Map<string, CachedIssue>();
    for (const r of cached.rows) {
      const issue = withDescription ? { ...r.issue, fields: { ...r.issue.fields, description: r.description ?? null } } : r.issue;
      rows.set(r.issue_id, {
        issue,
        sig: r.fields_sig,
        secured: r.secured,
        updatedMs: ms(r.jira_updated),
        staleAtMs: ms(r.stale_at),
        syncedAtMs: r.synced_at.getTime(),
      });
    }
    const s = sync.rows[0];
    const state: SyncState = {
      deltaFromMs: ms(s?.delta_from ?? null),
      lastDeltaMs: ms(s?.last_delta_at ?? null),
      extraFields: s?.extra_fields ?? [],
      changedMs: ms(s?.changed_at ?? null),
    };
    return { rows, sync: state };
  },

  async loadVisibility(cloudId, projectKey, accountId) {
    const res = await db().query<{ issue_ids: string[]; checked_at: Date; reusable: boolean }>(
      `SELECT issue_ids, checked_at, reusable FROM jira_issue_visibility
        WHERE cloud_id = $1 AND project_key = $2 AND account_id = $3`,
      [cloudId, projectKey, accountId]
    );
    const r = res.rows[0];
    return r ? ({ ids: r.issue_ids, checkedAtMs: r.checked_at.getTime(), reusable: r.reusable } satisfies Visibility) : null;
  },

  async saveVisibility(cloudId, projectKey, accountId, ids) {
    await db().query(
      `INSERT INTO jira_issue_visibility (cloud_id, project_key, account_id, issue_ids, checked_at, reusable)
       VALUES ($1, $2, $3, $4, now(), true)
       ON CONFLICT (cloud_id, project_key, account_id)
       DO UPDATE SET issue_ids = EXCLUDED.issue_ids, checked_at = EXCLUDED.checked_at, reusable = true`,
      [cloudId, projectKey, accountId, ids]
    );
  },

  async upsert(cloudId, projectKey, issues, sig, exactSinceMs) {
    // shouldReplace, in SQL. A row is always inserted when absent.
    const replace =
      exactSinceMs !== undefined
        ? `c.stale_at IS NULL OR c.stale_at <= $4`
        : `c.stale_at IS NULL AND (c.jira_updated IS NULL OR EXCLUDED.jira_updated IS NULL OR EXCLUDED.jira_updated >= c.jira_updated)`;
    for (let i = 0; i < issues.length; i += UPSERT_CHUNK) {
      const rows = issues.slice(i, i + UPSERT_CHUNK).map((issue) => {
        const { description, ...fields } = issue.fields ?? {};
        const updated = jiraTimeMs(fields.updated);
        return {
          issue_id: String(issue.id),
          issue_key: String(issue.key),
          // A moved issue's key names its new project; the row follows it there.
          project_key: typeof issue.key === "string" && /-\d+$/.test(issue.key) ? issue.key.replace(/-\d+$/, "") : projectKey,
          issue: { ...issue, fields },
          description: description ?? null,
          fields_sig: sig,
          secured: !!fields.security,
          jira_updated: updated === null ? null : new Date(updated).toISOString(),
        };
      });
      const params: unknown[] = [cloudId, JSON.stringify(rows), projectKey];
      if (exactSinceMs !== undefined) params.push(new Date(exactSinceMs).toISOString());
      await db().query(
        `INSERT INTO jira_issue_cache AS c
           (cloud_id, issue_id, issue_key, project_key, issue, description, fields_sig, secured, jira_updated, stale_at, synced_at)
         SELECT $1, x.issue_id, x.issue_key, coalesce(x.project_key, $3), x.issue, x.description, x.fields_sig, x.secured, x.jira_updated, NULL, now()
           FROM jsonb_to_recordset($2::jsonb) AS x(
             issue_id text, issue_key text, project_key text, issue jsonb, description jsonb,
             fields_sig text, secured boolean, jira_updated timestamptz)
         ON CONFLICT (cloud_id, issue_id) DO UPDATE SET
           issue_key = EXCLUDED.issue_key, project_key = EXCLUDED.project_key, issue = EXCLUDED.issue,
           description = EXCLUDED.description, fields_sig = EXCLUDED.fields_sig, secured = EXCLUDED.secured,
           jira_updated = EXCLUDED.jira_updated, stale_at = NULL, synced_at = now()
         WHERE ${replace}`,
        params
      );
    }
  },

  async remove(cloudId, issueIds) {
    if (issueIds.length === 0) return;
    await db().query(`DELETE FROM jira_issue_cache WHERE cloud_id = $1 AND issue_id = ANY($2)`, [cloudId, issueIds]);
  },

  async saveSync(cloudId, projectKey, patch) {
    // Only the columns named in the patch are written; the others keep what they hold.
    const iso = (v: number | null | undefined) => (typeof v === "number" ? new Date(v).toISOString() : null);
    const columns: Array<[string, unknown]> = [];
    if (patch.deltaFromMs !== undefined) columns.push(["delta_from", iso(patch.deltaFromMs)]);
    if (patch.lastDeltaMs !== undefined) columns.push(["last_delta_at", iso(patch.lastDeltaMs)]);
    if (patch.extraFields !== undefined) columns.push(["extra_fields", patch.extraFields]);
    if (patch.changedMs !== undefined) columns.push(["changed_at", iso(patch.changedMs)]);
    if (columns.length === 0) return;
    const names = columns.map(([c]) => c);
    await db().query(
      `INSERT INTO jira_project_sync (cloud_id, project_key, ${names.join(", ")})
       VALUES ($1, $2, ${names.map((_, i) => `$${i + 3}`).join(", ")})
       ON CONFLICT (cloud_id, project_key) DO UPDATE SET ${names.map((c) => `${c} = EXCLUDED.${c}`).join(", ")}`,
      [cloudId, projectKey, ...columns.map(([, v]) => v)]
    );
  },

  async withFillLock(cloudId, projectKey, fn) {
    const lockKey = `issue-fill|${cloudId}|${projectKey}`;
    const deadline = Date.now() + FILL_LOCK_WAIT_MS;
    for (;;) {
      const client = await db().connect();
      let held = false;
      try {
        held = (await client.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS ok`, [lockKey])).rows[0].ok;
        if (held || Date.now() > deadline) return await fn();
      } finally {
        if (held) await client.query(`SELECT pg_advisory_unlock(hashtextextended($1, 0))`, [lockKey]).catch(() => {});
        client.release();
      }
      await sleep(500);
    }
  },
};

/**
 * What a successful Jira write does to the copy, applied before the request that made it
 * returns — so the refresh that follows already knows. Never throws: the write itself worked,
 * and a cache that could not be told is caught by the next "what changed" read.
 */
export async function applyWriteToCache(
  cloudId: string,
  accountId: string,
  write: { method: string; path: string; body?: string }
): Promise<void> {
  const effect = writeEffect(write.method, write.path, write.body);
  if (isEmptyEffect(effect)) return;
  try {
    if (effect.patch) {
      const { description, ...fields } = effect.patch.fields;
      await db().query(
        `UPDATE jira_issue_cache
            SET issue = jsonb_set(issue, '{fields}', coalesce(issue->'fields', '{}'::jsonb) || $3::jsonb),
                description = CASE WHEN $4 THEN $5::jsonb ELSE description END,
                stale_at = now()
          WHERE cloud_id = $1 AND (issue_key = $2 OR issue_id = $2)`,
        [cloudId, effect.patch.key, JSON.stringify(fields), description !== undefined, JSON.stringify(description ?? null)]
      );
    }
    if (effect.stale.length > 0) {
      await db().query(
        `UPDATE jira_issue_cache SET stale_at = now() WHERE cloud_id = $1 AND (issue_key = ANY($2) OR issue_id = ANY($2))`,
        [cloudId, effect.stale]
      );
    }
    if (effect.deleted.length > 0) {
      await db().query(`DELETE FROM jira_issue_cache WHERE cloud_id = $1 AND (issue_key = ANY($2) OR issue_id = ANY($2))`, [
        cloudId,
        effect.deleted,
      ]);
    }
    for (const sprintId of effect.sprints) {
      // Every issue in the sprint carries its own copy of the sprint's name and state.
      await db().query(
        `UPDATE jira_issue_cache SET stale_at = now()
          WHERE cloud_id = $1
            AND jsonb_path_exists(issue, '$.fields.*[*] ? (@.id == $sid && exists(@.boardId))', jsonb_build_object('sid', $2::int))`,
        [cloudId, sprintId]
      );
    }
    if (effect.created) {
      await db().query(`UPDATE jira_issue_visibility SET reusable = false WHERE cloud_id = $1 AND account_id = $2`, [cloudId, accountId]);
    }
  } catch (err) {
    console.warn(`[issueCache] could not record ${write.method} ${write.path.split("?")[0]}: ${(err as Error)?.message ?? err}`);
  }
}
