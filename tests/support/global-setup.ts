import { config } from "dotenv";
import pg from "pg";
import { runMigrations } from "../../scripts/migrate";

export default async function globalSetup(): Promise<void> {
  config({ path: ".env.local" });
  config();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL must be set to run tests");
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    throw new Error("Refusing to run destructive test setup against a non-local database");
  }

  // Rebuild the test schema from scratch so migrations are verified on every run.
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  await client.end();

  await runMigrations(url);
}
