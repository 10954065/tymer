/**
 * Applies pending SQL migrations from ./drizzle using the direct (unpooled) connection.
 * Usage: npm run db:migrate
 */
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

config({ path: ".env.local" });
config();

export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL_UNPOOLED (or DATABASE_URL) must be set");
  }
  await runMigrations(url);
  console.info("Migrations applied successfully.");
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/migrate.ts");
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error("Migration failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
