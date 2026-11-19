import { eq } from "drizzle-orm";
import type { DbClient } from "@/server/db/client";
import { businessSettings } from "@/server/db/schema";
import { diffFields, recordAudit } from "./audit";
import type { Actor } from "./users";

export type BusinessSettings = typeof businessSettings.$inferSelect;

export async function getSettings(db: DbClient): Promise<BusinessSettings> {
  const [row] = await db.select().from(businessSettings).where(eq(businessSettings.id, 1)).limit(1);
  if (row) return row;
  const [created] = await db.insert(businessSettings).values({ id: 1 }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(businessSettings).where(eq(businessSettings.id, 1)))[0];
}

export interface SettingsInput {
  businessName: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  receiptFooter: string | null;
  allowNegativeStock: boolean;
  defaultReorderThreshold: number;
  cashierMaxDiscountBps: number;
  taxRateBps: number;
  taxLabel: string | null;
}

export async function updateSettings(db: DbClient, actor: Actor, input: SettingsInput): Promise<BusinessSettings> {
  const current = await getSettings(db);
  // Whitelist the editable columns so stray input keys can never reach the update or the audit log.
  const values = {
    businessName: input.businessName,
    address: input.address,
    phone: input.phone,
    email: input.email,
    receiptFooter: input.receiptFooter,
    allowNegativeStock: input.allowNegativeStock,
    defaultReorderThreshold: input.defaultReorderThreshold,
    cashierMaxDiscountBps: input.cashierMaxDiscountBps,
    taxRateBps: input.taxRateBps,
    taxLabel: input.taxLabel,
  };
  const changes = diffFields(current as unknown as Record<string, unknown>, values);
  if (!changes) return current;
  const [updated] = await db
    .update(businessSettings)
    .set({ ...values, updatedBy: actor.id })
    .where(eq(businessSettings.id, 1))
    .returning();
  await recordAudit(db, { userId: actor.id, action: "settings.updated", entityType: "settings", entityId: 1, ...changes });
  return updated;
}
