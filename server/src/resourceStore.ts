import { db } from "./db/pool.js";

/**
 * The resource pool: who is on the team, how much of a day each can actually
 * give, and when they are away.
 *
 * Deliberately NOT a people directory — Jira already is one, and duplicating it
 * would immediately go stale. Only the two things Jira has no field for live
 * here: capacity and planned absence. Everyone's name, avatar and account id
 * still come from `getAssignableUsers`, and a person with no row here simply
 * gets the default capacity, so the table starting empty is a valid state
 * rather than a setup step.
 */

/**
 * A full-time day. Anything else is per-person and stored.
 *
 * Must match `capacity_hours_per_day`'s DEFAULT in migrations/001_init.sql —
 * the column's default is what an insert without capacity actually gets, and
 * this constant is only what the API reports to the client as "the default".
 */
export const DEFAULT_CAPACITY_HOURS = 8;

export interface ResourceProfile {
  accountId: string;
  role: string | null;
  skills: string[];
  capacityHoursPerDay: number;
  costPerDay: number | null;
  notes: string | null;
}

export interface ResourceAbsence {
  id: string;
  accountId: string;
  from: string;
  to: string;
  reason: string | null;
}

interface ProfileRow {
  account_id: string;
  role: string | null;
  skills: string[] | null;
  capacity_hours_per_day: string | number;
  cost_per_day: string | number | null;
  notes: string | null;
}

interface AbsenceRow {
  id: string;
  account_id: string;
  from_date: string;
  to_date: string;
  reason: string | null;
}

// numeric columns come back as strings from node-postgres (it refuses to lose
// precision silently), so every one of them is parsed here rather than leaving
// each caller to remember.
function toProfile(row: ProfileRow): ResourceProfile {
  return {
    accountId: row.account_id,
    role: row.role,
    skills: row.skills ?? [],
    capacityHoursPerDay: Number(row.capacity_hours_per_day),
    costPerDay: row.cost_per_day === null ? null : Number(row.cost_per_day),
    notes: row.notes,
  };
}

export async function listProfiles(cloudId: string): Promise<ResourceProfile[]> {
  const { rows } = await db().query<ProfileRow>(
    `SELECT account_id, role, skills, capacity_hours_per_day, cost_per_day, notes
       FROM resource_profile WHERE cloud_id = $1`,
    [cloudId]
  );
  return rows.map(toProfile);
}

/** Keyed by accountId — the shape the AI planner wants for skill matching. */
export async function profilesByAccount(
  cloudId: string
): Promise<Map<string, { role: string | null; skills: string[] }>> {
  const profiles = await listProfiles(cloudId);
  return new Map(profiles.map((p) => [p.accountId, { role: p.role, skills: p.skills }]));
}

/**
 * Upsert, because a profile is created the first time anyone edits one — there
 * is no "add person" step to hang a plain INSERT off. display_name is required
 * by the table but is only a convenience copy of Jira's; the resource view reads
 * the live name from Jira, so a rename there needs no migration here.
 */
export async function saveProfile(
  cloudId: string,
  accountId: string,
  displayName: string,
  patch: { role?: string | null; skills?: string[]; capacityHoursPerDay?: number; notes?: string | null }
): Promise<ResourceProfile> {
  // Only the fields actually in the patch are listed, and the update half reads
  // them back off EXCLUDED. That gives both halves for free: on insert, an
  // omitted column takes the table's DEFAULT (capacity 8, skills '{}'); on
  // conflict, it is left exactly as it was. COALESCE cannot express the second
  // one — `COALESCE($n, old)` means an explicit null is indistinguishable from
  // "not sent", so a role could be set but never cleared.
  const columns = ["cloud_id", "account_id", "display_name"];
  const values: unknown[] = [cloudId, accountId, displayName];
  const updates = ["display_name = EXCLUDED.display_name", "updated_at = now()"];

  const include = (column: string, value: unknown) => {
    columns.push(column);
    values.push(value);
    updates.push(`${column} = EXCLUDED.${column}`);
  };
  if (patch.role !== undefined) include("role", patch.role);
  if (patch.skills !== undefined) include("skills", patch.skills);
  if (patch.capacityHoursPerDay !== undefined)
    include("capacity_hours_per_day", patch.capacityHoursPerDay);
  if (patch.notes !== undefined) include("notes", patch.notes);

  const { rows } = await db().query<ProfileRow>(
    `INSERT INTO resource_profile (${columns.join(", ")})
     VALUES (${values.map((_, i) => `$${i + 1}`).join(", ")})
     ON CONFLICT (cloud_id, account_id) DO UPDATE SET ${updates.join(", ")}
     RETURNING account_id, role, skills, capacity_hours_per_day, cost_per_day, notes`,
    values
  );
  return toProfile(rows[0]);
}

export async function listAbsences(cloudId: string, from?: string): Promise<ResourceAbsence[]> {
  const { rows } = await db().query<AbsenceRow>(
    from
      ? `SELECT id, account_id, from_date, to_date, reason FROM resource_absence
           WHERE cloud_id = $1 AND to_date >= $2 ORDER BY from_date`
      : `SELECT id, account_id, from_date, to_date, reason FROM resource_absence
           WHERE cloud_id = $1 ORDER BY from_date`,
    from ? [cloudId, from] : [cloudId]
  );
  return rows.map((r) => ({
    id: String(r.id),
    accountId: r.account_id,
    from: r.from_date,
    to: r.to_date,
    reason: r.reason,
  }));
}

/** Grouped by accountId, for the planner's "who is away when" prompt input. */
export async function absencesByAccount(
  cloudId: string,
  from: string
): Promise<Map<string, Array<{ from: string; to: string }>>> {
  const absences = await listAbsences(cloudId, from);
  const out = new Map<string, Array<{ from: string; to: string }>>();
  for (const a of absences) {
    const list = out.get(a.accountId) ?? [];
    list.push({ from: a.from, to: a.to });
    out.set(a.accountId, list);
  }
  return out;
}

export async function addAbsence(
  cloudId: string,
  accountId: string,
  from: string,
  to: string,
  reason: string | null
): Promise<ResourceAbsence> {
  const { rows } = await db().query<AbsenceRow>(
    `INSERT INTO resource_absence (cloud_id, account_id, from_date, to_date, reason)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, account_id, from_date, to_date, reason`,
    [cloudId, accountId, from, to, reason]
  );
  const r = rows[0];
  return { id: String(r.id), accountId: r.account_id, from: r.from_date, to: r.to_date, reason: r.reason };
}

export async function deleteAbsence(cloudId: string, id: string): Promise<void> {
  // cloud_id in the WHERE, not just the id: a bigserial id is guessable, and
  // every other table in this app is scoped the same way.
  await db().query(`DELETE FROM resource_absence WHERE cloud_id = $1 AND id = $2`, [cloudId, id]);
}
