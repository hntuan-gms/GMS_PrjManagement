import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { migrate } from "./migrate.js";
import { db } from "./pool.js";
import * as store from "../store.js";

/**
 * One-off: copies the pre-Postgres lowdb file (data/overlay.v2.json) into the
 * database. Idempotent — re-running overwrites the same rows rather than
 * duplicating them — so it is safe to run again if the first attempt half
 * finished.
 *
 *   npm run db:import-overlay [-- path/to/overlay.v2.json]
 */
interface LegacyOverlay {
  startDate: string | null;
  durationDays: number;
  percentComplete: number;
  predecessors: Array<{ taskId: string; type: string; lagDays: number }>;
  baselineStart: string | null;
  baselineDue: string | null;
}

interface LegacyFile {
  schemaVersion: number;
  scopes: Record<string, Record<string, LegacyOverlay>>;
}

const file = process.argv[2] ?? path.join(process.cwd(), "data", "overlay.v2.json");

let raw: string;
try {
  raw = await readFile(file, "utf8");
} catch {
  console.log(`[import] no file at ${file} — nothing to import.`);
  await db().end();
  process.exit(0);
}

await migrate();

const parsed = JSON.parse(raw) as LegacyFile;
let overlays = 0;
let dependencies = 0;

for (const [cloudId, bucket] of Object.entries(parsed.scopes ?? {})) {
  for (const [issueKey, legacy] of Object.entries(bucket)) {
    // setOverlay (not setOverlays) because this carries dependencies too.
    await store.setOverlay(cloudId, issueKey, {
      startDate: legacy.startDate,
      durationDays: legacy.durationDays,
      percentComplete: legacy.percentComplete,
      baselineStart: legacy.baselineStart,
      baselineDue: legacy.baselineDue,
      predecessors: (legacy.predecessors ?? []) as store.TaskOverlay["predecessors"],
    });
    overlays++;
    dependencies += legacy.predecessors?.length ?? 0;
  }
}

console.log(`[import] ${overlays} overlay(s), ${dependencies} dependency edge(s) from ${file}`);
await db().end();
