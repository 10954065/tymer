import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { settingsSchema } from "@/lib/validation/settings";
import { closeDb, getDb } from "@/server/db/client";
import { auditLogs } from "@/server/db/schema";
import { getSettings, updateSettings } from "@/server/services/settings";
import { actor, createTestUser } from "../support/factories";
import { resetDatabase } from "../support/db";

const db = () => getDb();

describe("business settings", () => {
  beforeEach(resetDatabase);
  afterAll(closeDb);

  it("returns defaults for a new installation", async () => {
    const settings = await getSettings(db());
    expect(settings).toMatchObject({
      businessName: "SMARTLIVING BUYNFRY VENTURES",
      allowNegativeStock: false,
      taxRateBps: 0,
      cashierMaxDiscountBps: 1000,
    });
  });

  it("converts percentages to basis points and audits only changed fields", async () => {
    const owner = await createTestUser("OWNER");
    const input = settingsSchema.parse({
      businessName: "SMARTLIVING BUYNFRY VENTURES",
      address: "Spintex Road, Accra",
      phone: "",
      email: "",
      receiptFooter: "Thank you for shopping with us!",
      allowNegativeStock: false,
      defaultReorderThreshold: "5",
      cashierMaxDiscountPercent: "7.5",
      taxRatePercent: "0",
      taxLabel: "VAT",
    });
    expect(input.cashierMaxDiscountPercent).toBe(750);

    await updateSettings(db(), actor(owner), {
      ...input,
      cashierMaxDiscountBps: input.cashierMaxDiscountPercent,
      taxRateBps: input.taxRatePercent,
    });
    const settings = await getSettings(db());
    expect(settings.cashierMaxDiscountBps).toBe(750);
    expect(settings.address).toBe("Spintex Road, Accra");

    const [audit] = await db().select().from(auditLogs).where(eq(auditLogs.action, "settings.updated"));
    expect(audit.after).toEqual({ address: "Spintex Road, Accra", cashierMaxDiscountBps: 750 });
  });

  it("rejects invalid percentages", () => {
    const result = settingsSchema.safeParse({
      businessName: "X",
      allowNegativeStock: false,
      defaultReorderThreshold: 5,
      cashierMaxDiscountPercent: "150",
      taxRatePercent: "0",
    });
    expect(result.success).toBe(false);
  });
});
