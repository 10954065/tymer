import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

// int8 (bigint) and numeric come back from pg as strings. All monetary values in this app are
// integer pesewas far below Number.MAX_SAFE_INTEGER, so parse them as numbers.
pg.types.setTypeParser(20, (value) => Number(value));
pg.types.setTypeParser(1700, (value) => Number(value));

export type Database = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Anything that can run queries: the pooled database or an open transaction. */
export type DbClient = Database | Tx;

const globalForDb = globalThis as unknown as { slbPool?: pg.Pool; slbDb?: Database };

function createPool(): pg.Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }
  const pool = new pg.Pool({
    connectionString,
    max: Number(process.env.DB_POOL_MAX ?? 5),
    // Release idle connections quickly so Neon compute can scale to zero when the shop is quiet.
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
    allowExitOnIdle: true,
  });
  pool.on("error", (error) => {
    console.error("[db] idle client error", error.message);
  });
  return pool;
}

export function getPool(): pg.Pool {
  if (!globalForDb.slbPool) {
    globalForDb.slbPool = createPool();
  }
  return globalForDb.slbPool;
}

export function getDb(): Database {
  if (!globalForDb.slbDb) {
    globalForDb.slbDb = drizzle(getPool(), { schema });
  }
  return globalForDb.slbDb;
}

export async function closeDb(): Promise<void> {
  if (globalForDb.slbPool) {
    await globalForDb.slbPool.end();
    globalForDb.slbPool = undefined;
    globalForDb.slbDb = undefined;
  }
}
