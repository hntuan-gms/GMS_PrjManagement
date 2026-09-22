import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Resolves to server/migrations from both src/db (tsx) and dist/db (built).
const migrationsDir = path.join(__dirname, "../../migrations");

// Any 64-bit constant; it only has to be the same in every instance.
const MIGRATION_LOCK_ID = 8_274_119_003_551_001n;

/**
 * Applies every unapplied migration, in filename order, each in its own
 * transaction. Safe to call from several instances at once: the advisory lock
 * means the second one waits and then finds nothing left to do, rather than both
 * racing to CREATE the same table.
 */
export async function migrate(): Promise<void> {
  const client = await db().connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID.toString()]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migration (
        version    text        PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const applied = new Set(
      (await client.query<{ version: string }>("SELECT version FROM schema_migration")).rows.map(
        (r) => r.version
      )
    );
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migration (version) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`[db] applied migration ${file}`);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID.toString()]).catch(() => {});
    client.release();
  }
}
