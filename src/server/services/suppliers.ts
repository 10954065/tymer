import { asc, eq } from "drizzle-orm";
import type { DbClient } from "@/server/db/client";
import { suppliers } from "@/server/db/schema";

export async function listSupplierOptions(db: DbClient) {
  return db
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(eq(suppliers.isActive, true))
    .orderBy(asc(suppliers.name));
}
