import { sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";

const DATA_TABLES = [
  "audit_logs",
  "backup_runs",
  "sync_conflicts",
  "sync_devices",
  "cash_sessions",
  "expenses",
  "supplier_payments",
  "purchase_items",
  "purchases",
  "payments",
  "sale_return_items",
  "sale_returns",
  "sale_items",
  "sales",
  "order_items",
  "orders",
  "customers",
  "inventory_movements",
  "product_price_changes",
  "products",
  "categories",
  "suppliers",
  "sessions",
  "users",
];

/** Wipes all business data between tests while keeping migrated reference data. */
export async function resetDatabase(): Promise<void> {
  const db = getDb();
  await db.execute(sql.raw(`TRUNCATE TABLE ${DATA_TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`));
  // business_settings references users, so the CASCADE above empties it; restore the singleton row.
  await db.execute(sql`INSERT INTO business_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
}
