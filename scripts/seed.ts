/**
 * Creates the initial OWNER account when the database has no users.
 * Credentials come from SEED_OWNER_* environment variables; the owner must change the password on first login.
 * Usage: npm run db:seed
 */
import { config } from "dotenv";

config({ path: ".env.local" });
config();

async function main(): Promise<void> {
  const { getDb, closeDb } = await import("../src/server/db/client");
  const { bootstrapOwner } = await import("../src/server/services/users");
  const username = process.env.SEED_OWNER_USERNAME;
  const password = process.env.SEED_OWNER_PASSWORD;
  const fullName = process.env.SEED_OWNER_NAME ?? "Shop Owner";
  if (!username || !password) {
    throw new Error("Set SEED_OWNER_USERNAME and SEED_OWNER_PASSWORD before seeding");
  }
  try {
    const result = await getDb().transaction((tx) => bootstrapOwner(tx, { username, password, fullName }));
    console.info(result.created ? `Owner account "${username}" created.` : "Users already exist; nothing to seed.");
  } finally {
    await closeDb();
  }
}

main().catch((error: unknown) => {
  console.error("Seeding failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
