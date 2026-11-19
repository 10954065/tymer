"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/errors";
import { requiredText } from "@/lib/validation/common";
import { actorOf, requireActionPermission } from "@/server/auth/current-user";
import { CACHE_TAGS, FINANCIAL_TAGS, invalidate } from "@/server/cache";
import { getDb } from "@/server/db/client";
import { resolveSyncConflict } from "@/server/services/sync";
import { parseInput, runAction } from "./run";

export async function resolveSyncConflictAction(input: unknown): Promise<ActionResult<{ saleId: string | null }>> {
  return runAction(async () => {
    const session = await requireActionPermission("sync:review");
    const data = parseInput(z.object({ conflictId: z.uuid(), decision: z.enum(["record", "dismiss"]), note: requiredText(300, "Note").min(3) }), input);
    const result = await resolveSyncConflict(getDb(), actorOf(session), data);
    invalidate(CACHE_TAGS.catalog, ...FINANCIAL_TAGS);
    revalidatePath("/sales/sync-conflicts");
    revalidatePath("/sales");
    return result;
  });
}
