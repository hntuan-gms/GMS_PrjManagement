/** The Postgres side of projectMembers.ts's member cache (project_member_cache). */
import { db } from "./db/pool.js";
import type { MemberPersistence, ProjectMembers } from "./projectMembers.js";

export const pgMemberCache: MemberPersistence = {
  async get(cloudId, projectKey, accountId) {
    const res = await db().query<{ members: ProjectMembers }>(
      `SELECT members FROM project_member_cache
        WHERE cloud_id = $1 AND project_key = $2 AND account_id = $3 AND expires_at > now()`,
      [cloudId, projectKey, accountId]
    );
    return res.rows[0]?.members ?? null;
  },
  async put(cloudId, projectKey, accountId, value, ttlMs) {
    await db().query(
      `INSERT INTO project_member_cache (cloud_id, project_key, account_id, members, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))
       ON CONFLICT (cloud_id, project_key, account_id) DO UPDATE SET members = EXCLUDED.members, expires_at = EXCLUDED.expires_at`,
      [cloudId, projectKey, accountId, JSON.stringify(value), Math.round(ttlMs / 1000)]
    );
  },
  async dropProject(cloudId, projectKey) {
    await db().query(`DELETE FROM project_member_cache WHERE cloud_id = $1 AND project_key = $2`, [cloudId, projectKey]);
  },
};
