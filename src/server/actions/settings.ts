"use server";

import type { ActionResult } from "@/lib/errors";
import { settingsSchema } from "@/lib/validation/settings";
import { actorOf, requireActionPermission } from "@/server/auth/current-user";
import { CACHE_TAGS, invalidate } from "@/server/cache";
import { getDb } from "@/server/db/client";
import { updateSettings } from "@/server/services/settings";
import { parseInput, runAction } from "./run";

export async function updateSettingsAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireActionPermission("settings:manage");
    const data = parseInput(settingsSchema, input);
    await getDb().transaction((tx) =>
      updateSettings(tx, actorOf(session), {
        businessName: data.businessName,
        address: data.address,
        phone: data.phone,
        email: data.email,
        receiptFooter: data.receiptFooter,
        allowNegativeStock: data.allowNegativeStock,
        defaultReorderThreshold: data.defaultReorderThreshold,
        cashierMaxDiscountBps: data.cashierMaxDiscountPercent,
        taxRateBps: data.taxRatePercent,
        taxLabel: data.taxLabel,
      }),
    );
    invalidate(CACHE_TAGS.settings, CACHE_TAGS.catalog);
    return undefined;
  });
}
