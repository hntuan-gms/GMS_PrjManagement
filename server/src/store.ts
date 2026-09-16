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

interface DbShape {
  overlays: Record<string, TaskOverlay>;
}

const dataDir = path.join(process.cwd(), "data");
await mkdir(dataDir, { recursive: true });
const dbPath = path.join(dataDir, "overlay.json");
const db = await JSONFilePreset<DbShape>(dbPath, { overlays: {} });

export const defaultOverlay = (): TaskOverlay => ({
  startDate: null,
  durationDays: 1,
  percentComplete: 0,
  predecessors: [],
  baselineStart: null,
  baselineDue: null,
});

export async function getOverlay(taskId: string): Promise<TaskOverlay> {
  return db.data.overlays[taskId] ?? defaultOverlay();
}

export async function getAllOverlays(): Promise<Record<string, TaskOverlay>> {
  return db.data.overlays;
}

export async function setOverlay(taskId: string, patch: Partial<TaskOverlay>): Promise<TaskOverlay> {
  const current = db.data.overlays[taskId] ?? defaultOverlay();
  const next = { ...current, ...patch };
  db.data.overlays[taskId] = next;
  await db.write();
  return next;
}

export async function deleteOverlay(taskId: string): Promise<void> {
  delete db.data.overlays[taskId];
  // Also strip this task from any other task's predecessor list.
  for (const overlay of Object.values(db.data.overlays)) {
    overlay.predecessors = overlay.predecessors.filter((p) => p.taskId !== taskId);
  }
  await db.write();
}

export async function renameTaskIdEverywhere(oldId: string, newId: string): Promise<void> {
  if (db.data.overlays[oldId]) {
    db.data.overlays[newId] = db.data.overlays[oldId];
    delete db.data.overlays[oldId];
  }
  for (const overlay of Object.values(db.data.overlays)) {
    overlay.predecessors = overlay.predecessors.map((p) =>
      p.taskId === oldId ? { ...p, taskId: newId } : p
    );
  }
  await db.write();
}
