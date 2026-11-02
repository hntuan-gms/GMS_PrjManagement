import { db } from "./db/pool.js";
import { withSlaDefaults, type SlaSettings } from "./sla.js";
import { toWorkCalendar, type WorkCalendar } from "./workCalendar.js";

/** A project's SLA policy, defaults filled in. Keyed by site and project, like every table here. */
export async function getSlaSettings(cloudId: string, projectKey: string): Promise<SlaSettings> {
  const { rows } = await db().query<{ settings: Partial<SlaSettings> }>(
    `SELECT settings FROM sla_settings WHERE cloud_id = $1 AND project_key = $2`,
    [cloudId, projectKey]
  );
  return withSlaDefaults(rows[0]?.settings);
}

/**
 * Writes only the fields in `patch`, merged into whatever the row already holds (jsonb `||`), in one
 * statement. The SLA dialog and the calendar dialog share this row and each saves only its own fields,
 * so one of them saving cannot put back what the other just changed. A project with no row yet starts
 * from the defaults.
 */
export async function patchSlaSettings(
  cloudId: string,
  projectKey: string,
  accountId: string,
  patch: Partial<SlaSettings>
): Promise<SlaSettings> {
  const { rows } = await db().query<{ settings: Partial<SlaSettings> }>(
    `INSERT INTO sla_settings (cloud_id, project_key, settings, updated_by)
     VALUES ($1, $2, $3::jsonb || $4::jsonb, $5)
     ON CONFLICT (cloud_id, project_key)
     DO UPDATE SET settings = sla_settings.settings || $4::jsonb, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING settings`,
    [cloudId, projectKey, JSON.stringify(withSlaDefaults(null)), JSON.stringify(patch), accountId]
  );
  return withSlaDefaults(rows[0]?.settings);
}

/** The project's working calendar (Monday–Friday, no holidays, until someone saves one). */
export async function getWorkCalendar(cloudId: string, projectKey: string): Promise<WorkCalendar> {
  return toWorkCalendar(await getSlaSettings(cloudId, projectKey));
}
