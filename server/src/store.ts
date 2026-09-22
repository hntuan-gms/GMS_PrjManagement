import { JSONFilePreset } from "lowdb/node";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Predecessor } from "./types.js";

export interface TaskOverlay {
  startDate: string | null;
  durationDays: number;
  percentComplete: number;
  predecessors: Predecessor[];
  baselineStart: string | null;
  baselineDue: string | null;
}

/**
 * Overlays are nested under the Atlassian cloudId rather than keyed by a flat
 * "cloudId:issueKey" composite. Predecessor.taskId is a bare issue key on the
 * wire, and within one scope bucket a bare key is unambiguous — a composite key
 * would force either composite predecessor ids (a client-visible format change)
 * or a global scan to work out which scope a bare id belongs to.
 *
 * v1 stored `{ overlays: Record<issueKey, TaskOverlay> }` with no site dimension,
 * so two sites that both contain ABC-1 collided. The file name changed with the
 * shape; a stale overlay.json is simply left on disk.
 */
interface DbShape {
  schemaVersion: 2;
  scopes: Record<string, Record<string, TaskOverlay>>;
}

const dataDir = path.join(process.cwd(), "data");
await mkdir(dataDir, { recursive: true });
const dbPath = path.join(dataDir, "overlay.v2.json");
const db = await JSONFilePreset<DbShape>(dbPath, { schemaVersion: 2, scopes: {} });

// lowdb only applies the default when the file is absent; an existing file from a
// partially-migrated state still needs the shape.
db.data.scopes ??= {};
db.data.schemaVersion = 2;

export const defaultOverlay = (): TaskOverlay => ({
  startDate: null,
  durationDays: 1,
  percentComplete: 0,
  predecessors: [],
  baselineStart: null,
  baselineDue: null,
});

function bucket(scope: string): Record<string, TaskOverlay> {
  return (db.data.scopes[scope] ??= {});
}

export async function getOverlay(scope: string, taskId: string): Promise<TaskOverlay> {
  return db.data.scopes[scope]?.[taskId] ?? defaultOverlay();
}

/** Every overlay in a scope, keyed by issue key. Read-only — does not create the scope bucket. */
export async function getAllOverlays(scope: string): Promise<Record<string, TaskOverlay>> {
  return db.data.scopes[scope] ?? {};
}

export async function setOverlay(
  scope: string,
  taskId: string,
  patch: Partial<TaskOverlay>
): Promise<TaskOverlay> {
  const scoped = bucket(scope);
  const next = { ...(scoped[taskId] ?? defaultOverlay()), ...patch };
  scoped[taskId] = next;
  await db.write();
  return next;
}

export async function deleteOverlay(scope: string, taskId: string): Promise<void> {
  const scoped = bucket(scope);
  delete scoped[taskId];
  // Strip this task from other tasks' predecessor lists — within this site only.
  // The old global sweep meant deleting ABC-1 on one site also severed ABC-1
  // dependencies on another.
  for (const overlay of Object.values(scoped)) {
    overlay.predecessors = overlay.predecessors.filter((p) => p.taskId !== taskId);
  }
  await db.write();
}
