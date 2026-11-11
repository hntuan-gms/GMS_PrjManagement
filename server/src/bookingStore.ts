/** resource_booking (migration 018). The rules about who sees and writes what are in booking.ts. */
import { db } from "./db/pool.js";
import type { Booking, BookingInput, BookingPatch, BookingStatus } from "./booking.js";

interface Row {
  id: string;
  account_id: string;
  project_key: string;
  from_date: string;
  to_date: string;
  hours_per_day: string | number;
  status: BookingStatus;
  note: string | null;
  created_by: string;
}

const COLUMNS = "id, account_id, project_key, from_date, to_date, hours_per_day, status, note, created_by";

function toBooking(r: Row): Booking {
  return {
    id: String(r.id),
    accountId: r.account_id,
    projectKey: r.project_key,
    from: r.from_date,
    to: r.to_date,
    hoursPerDay: Number(r.hours_per_day),
    status: r.status,
    note: r.note,
    createdBy: r.created_by,
  };
}

/** Every booking of the site that touches the window. One query: the view adds people up across projects. */
export async function listInRange(cloudId: string, from: string, to: string): Promise<Booking[]> {
  const { rows } = await db().query<Row>(
    `SELECT ${COLUMNS} FROM resource_booking
      WHERE cloud_id = $1 AND to_date >= $2 AND from_date <= $3
      ORDER BY from_date, id`,
    [cloudId, from, to]
  );
  return rows.map(toBooking);
}

export async function get(cloudId: string, id: string): Promise<Booking | null> {
  if (!/^\d{1,18}$/.test(id)) return null;
  const { rows } = await db().query<Row>(`SELECT ${COLUMNS} FROM resource_booking WHERE cloud_id = $1 AND id = $2`, [
    cloudId,
    id,
  ]);
  return rows[0] ? toBooking(rows[0]) : null;
}

export async function create(cloudId: string, createdBy: string, input: BookingInput): Promise<Booking> {
  const { rows } = await db().query<Row>(
    `INSERT INTO resource_booking (cloud_id, account_id, project_key, from_date, to_date, hours_per_day, status, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${COLUMNS}`,
    [cloudId, input.accountId, input.projectKey, input.from, input.to, input.hoursPerDay, input.status, input.note, createdBy]
  );
  return toBooking(rows[0]);
}

const PATCH_COLUMNS: Record<keyof BookingPatch, string> = {
  accountId: "account_id",
  from: "from_date",
  to: "to_date",
  hoursPerDay: "hours_per_day",
  status: "status",
  note: "note",
};

export async function update(cloudId: string, id: string, patch: BookingPatch): Promise<Booking | null> {
  const sets: string[] = ["updated_at = now()"];
  const values: unknown[] = [cloudId, id];
  for (const key of Object.keys(patch) as Array<keyof BookingPatch>) {
    values.push(patch[key]);
    sets.push(`${PATCH_COLUMNS[key]} = $${values.length}`);
  }
  const { rows } = await db().query<Row>(
    `UPDATE resource_booking SET ${sets.join(", ")} WHERE cloud_id = $1 AND id = $2 RETURNING ${COLUMNS}`,
    values
  );
  return rows[0] ? toBooking(rows[0]) : null;
}

export async function remove(cloudId: string, id: string): Promise<void> {
  await db().query(`DELETE FROM resource_booking WHERE cloud_id = $1 AND id = $2`, [cloudId, id]);
}
