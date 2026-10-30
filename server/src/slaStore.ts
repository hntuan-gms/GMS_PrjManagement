import { db } from "./db/pool.js";
import { withSlaDefaults, type SlaSettings } from "./sla.js";

/** A project's SLA policy, defaults filled in. Keyed by site and project, like every table here. */
export async function getSlaSettings(cloudId: string, projectKey: string): Promise<SlaSettings> {
  const { rows } = await db().query<{ settings: Partial<SlaSettings> }>(
    `SELECT settings FROM sla_settings WHERE cloud_id = $1 AND project_key = $2`,
    [cloudId, projectKey]
  );
  return withSlaDefaults(rows[0]?.settings);
}

/** Whole-object upsert: the dialog always sends every field, already validated. */
export async function saveSlaSettings(
  cloudId: string,
  projectKey: string,
  accountId: string,
  settings: SlaSettings
): Promise<SlaSettings> {
  await db().query(
    `INSERT INTO sla_settings (cloud_id, project_key, settings, updated_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (cloud_id, project_key)
     DO UPDATE SET settings = EXCLUDED.settings, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [cloudId, projectKey, JSON.stringify(settings), accountId]
  );
  return settings;
}
