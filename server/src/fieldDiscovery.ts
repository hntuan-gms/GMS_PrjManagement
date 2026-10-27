/**
 * Resolves this Jira site's native "Start date" field.
 *
 * `customfield_10059` used to be hard-coded — that ID is HHBJ/gimasys-specific.
 * Once users bring their own site, the same ID is either absent or a completely
 * different field, and TaskService writes start dates into it on every schedule
 * edit. Writing a date into an unrelated custom field is silent data corruption,
 * so the ID has to be discovered per site rather than assumed.
 *
 * Cached per cloudId at module level: the answer's lifetime is per-site, so it
 * belongs neither on a request nor on a session.
 */
import type { JiraClient } from "./jiraClient.js";

const TTL_MS = 60 * 60 * 1000;

const cache = new Map<string, { value: string | null; expiresAt: number }>();

type JiraField = Awaited<ReturnType<JiraClient["getFields"]>>[number];
const fieldList = new Map<string, { fields: Promise<JiraField[]>; expiresAt: number }>();

/**
 * The site's field list, fetched once per hour and shared by every lookup below: the
 * Start date and Sprint fields are both found in it, and each request would otherwise
 * pay for GET /field twice while either answer is cold. A failed fetch is not kept.
 */
function fieldsOf(jira: JiraClient, cloudId: string): Promise<JiraField[]> {
  const hit = fieldList.get(cloudId);
  if (hit && hit.expiresAt > Date.now()) return hit.fields;
  const fields = jira.getFields();
  fieldList.set(cloudId, { fields, expiresAt: Date.now() + TTL_MS });
  fields.catch(() => fieldList.delete(cloudId));
  return fields;
}

/** Jira's datepicker custom field types, in schema.custom. */
const DATE_FIELD_TYPES = [
  "com.atlassian.jira.plugin.system.customfieldtypes:datepicker",
  "com.atlassian.jira.plugin.system.customfieldtypes:datetime",
  // Advanced Roadmaps ships its own baseline start field.
  "com.atlassian.jpo:jpo-custom-field-baseline-start",
];

/**
 * Returns the field id, or null when the site has no such field — in which case
 * callers must omit it from writes entirely and let hydrate() fall back to
 * reconciling against `duedate` alone.
 */
export async function getStartDateFieldId(jira: JiraClient, cloudId: string): Promise<string | null> {
  const hit = cache.get(cloudId);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  let value: string | null = null;
  try {
    const fields = await fieldsOf(jira, cloudId);
    const match =
      fields.find(
        (f) =>
          f.custom &&
          f.name?.toLowerCase() === "start date" &&
          (f.schema?.type === "date" ||
            f.schema?.type === "datetime" ||
            DATE_FIELD_TYPES.includes(f.schema?.custom ?? ""))
      ) ?? fields.find((f) => f.custom && f.name?.toLowerCase() === "start date");
    value = match?.id ?? null;
  } catch (err) {
    // A discovery failure must not break the whole request: null degrades to the
    // duedate-only path, which is correct, just less precise. Don't cache it.
    console.warn(`[fieldDiscovery] could not resolve Start date field for ${cloudId}:`, err);
    return null;
  }

  cache.set(cloudId, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

const sprintCache = new Map<string, { value: string | null; expiresAt: number }>();

/**
 * The site's Sprint field, or null when it has none (no Jira Software, or a
 * team-managed project that keeps sprints elsewhere). Readable with the ordinary
 * `read:jira-work` scope, which is why Task.sprint does not wait for JIRA_AGILE.
 */
export async function getSprintFieldId(jira: JiraClient, cloudId: string): Promise<string | null> {
  const hit = sprintCache.get(cloudId);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  let value: string | null = null;
  try {
    const fields = await fieldsOf(jira, cloudId);
    const match =
      fields.find((f) => f.schema?.custom === "com.pyxis.greenhopper.jira:gh-sprint") ??
      fields.find((f) => f.custom && f.name?.toLowerCase() === "sprint");
    value = match?.id ?? null;
  } catch (err) {
    // Same stance as the Start date field: a failed lookup costs the Sprint column, not the request.
    console.warn(`[fieldDiscovery] could not resolve Sprint field for ${cloudId}:`, err);
    return null;
  }
  sprintCache.set(cloudId, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

const flaggedCache = new Map<string, { value: string | null; expiresAt: number }>();

/**
 * The checkbox field behind Jira's "Add flag" (named "Flagged"; an issue is flagged when it holds the
 * "Impediment" option). Null when the site has none. The agile API *reports* `flagged` on an issue
 * but offers no way to set it, so a flag is written through this ordinary field.
 */
export async function getFlaggedFieldId(jira: JiraClient, cloudId: string): Promise<string | null> {
  const hit = flaggedCache.get(cloudId);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  let value: string | null = null;
  try {
    const fields = await fieldsOf(jira, cloudId);
    value = fields.find((f) => f.custom && f.name?.toLowerCase() === "flagged")?.id ?? null;
  } catch (err) {
    console.warn(`[fieldDiscovery] could not resolve Flagged field for ${cloudId}:`, err);
    return null;
  }
  flaggedCache.set(cloudId, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

/** Optional escape hatch for a site whose field is named something else. */
export function startDateFieldOverride(): string | null {
  return process.env.JIRA_START_DATE_FIELD_ID?.trim() || null;
}
