import { db } from "../db/pool.js";
import { withDefaults, type KbktSettings } from "./settings.js";

/** A project's KBKT import settings, defaults filled in. Keyed by site and project, like every table here. */
export async function getSettings(cloudId: string, projectKey: string): Promise<KbktSettings> {
  const { rows } = await db().query<{ settings: Partial<KbktSettings> }>(
    `SELECT settings FROM kbkt_import_settings WHERE cloud_id = $1 AND project_key = $2`,
    [cloudId, projectKey]
  );
  return withDefaults(rows[0]?.settings);
}

/** Whole-object upsert: the dialog always sends every field, already validated. */
export async function saveSettings(
  cloudId: string,
  projectKey: string,
  accountId: string,
  settings: KbktSettings
): Promise<KbktSettings> {
  await db().query(
    `INSERT INTO kbkt_import_settings (cloud_id, project_key, settings, updated_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (cloud_id, project_key)
     DO UPDATE SET settings = EXCLUDED.settings, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [cloudId, projectKey, JSON.stringify(settings), accountId]
  );
  return settings;
}
