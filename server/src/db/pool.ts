import pg from "pg";

const { Pool, types } = pg;

// node-postgres parses DATE columns into JS Date objects in the process's local
// timezone, which in UTC+7 turns "2027-03-02" into the evening of 2027-03-01 and
// reintroduces BUG-04 at the database layer. Every date in this app is a plain
// YYYY-MM-DD string end to end (see CLAUDE.md), so hand DATE back verbatim.
const DATE_OID = 1082;
types.setTypeParser(DATE_OID, (value) => value);

let pool: pg.Pool | null = null;

/**
 * The process-wide pool, created on first use.
 *
 * Lazy rather than created at import time so a missing DATABASE_URL surfaces
 * through index.ts's startup check — with the message that says how to fix it —
 * instead of as an import-time stack trace before any of that code runs.
 *
 * Small on purpose: Cloud Run gives each instance a single CPU and Cloud SQL's
 * smaller tiers cap out around 25 connections for the whole instance, so a fat
 * pool per container just starves the next one.
 *
 * On Cloud Run the DATABASE_URL to use is the Cloud SQL unix socket form —
 * postgresql://user:pass@/dbname?host=/cloudsql/PROJECT:REGION:INSTANCE — which
 * needs no TLS settings because the connector terminates it. DATABASE_SSL=true is
 * for reaching a managed Postgres over a public IP instead.
 */
export function db(): pg.Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      "Missing required environment variable DATABASE_URL. Schedule overlays, " +
        "dependencies, baselines and the resource pool live in Postgres — see " +
        "server/.env.example. For local dev: docker compose up -d db"
    );
  }

  pool = new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ...(process.env.DATABASE_SSL === "true" ? { ssl: { rejectUnauthorized: false } } : {}),
  });

  // An idle client erroring out (a Cloud SQL restart, a network blip) is emitted
  // on the pool, and an unhandled 'error' event on an EventEmitter would take the
  // whole process down.
  pool.on("error", (err) => {
    console.error("[db] idle client error:", err.message);
  });

  return pool;
}

/** Runs `fn` inside a transaction, rolling back on any throw. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
