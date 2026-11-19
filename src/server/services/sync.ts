import { and, desc, eq, inArray } from "drizzle-orm";
import { AppError, isAppError, notFound } from "@/lib/errors";
import type { PaymentMethod } from "@/lib/validation/common";
import type { Database, DbClient, Tx } from "@/server/db/client";
import { products, sales, syncConflicts, syncDevices, users } from "@/server/db/schema";
import { recordAudit } from "./audit";
import { checkout } from "./sales";
import type { Actor } from "./users";

export interface OfflineSalePayload {
  idempotencyKey: string;
  customerId: string | null;
  items: { productId: string; quantity: number; discount: number; unitPrice: number; name?: string }[];
  cartDiscount: number;
  payments: { method: PaymentMethod; amount: number; externalReference?: string | null }[];
  notes?: string | null;
  clientCreatedAt: string;
}

export type SyncOutcome =
  | { idempotencyKey: string; status: "synced"; saleId: string; saleNumber: string; duplicate: boolean }
  | { idempotencyKey: string; status: "conflict"; reason: string; message: string }
  | { idempotencyKey: string; status: "retry"; message: string };

async function recordConflict(db: DbClient, actor: Actor, deviceId: string | null, sale: OfflineSalePayload, reason: string, details: Record<string, unknown>) {
  await db
    .insert(syncConflicts)
    .values({ idempotencyKey: sale.idempotencyKey, deviceId, submittedBy: actor.id, payload: sale, reason, details })
    .onConflictDoNothing({ target: syncConflicts.idempotencyKey });
}

/**
 * Replays one sale recorded offline. Never assumes the device knew the true stock: the server re-checks stock and
 * prices. Valid sales are recorded with the original idempotency key (so retries never duplicate); anything that no
 * longer matches is stored as a conflict for owner review — never silently discarded.
 */
export async function syncOfflineSale(db: Database, actor: Actor & { canOverrideDiscount: boolean }, deviceId: string | null, sale: OfflineSalePayload): Promise<SyncOutcome> {
  const key = sale.idempotencyKey;
  const [existing] = await db.select({ id: sales.id, saleNumber: sales.saleNumber }).from(sales).where(eq(sales.idempotencyKey, key));
  if (existing) return { idempotencyKey: key, status: "synced", saleId: existing.id, saleNumber: existing.saleNumber, duplicate: true };
  const [pending] = await db.select({ status: syncConflicts.status, reason: syncConflicts.reason }).from(syncConflicts).where(eq(syncConflicts.idempotencyKey, key));
  if (pending) return { idempotencyKey: key, status: "conflict", reason: pending.reason, message: "Waiting for owner review" };

  const ids = sale.items.map((i) => i.productId);
  const current = ids.length ? await db.select({ id: products.id, name: products.name, sellingPrice: products.sellingPrice }).from(products).where(inArray(products.id, ids)) : [];
  const changed = sale.items.filter((i) => current.find((p) => p.id === i.productId)?.sellingPrice !== i.unitPrice);
  if (changed.length > 0) {
    const details = { items: changed.map((i) => ({ productId: i.productId, offlinePrice: i.unitPrice, currentPrice: current.find((p) => p.id === i.productId)?.sellingPrice ?? null })) };
    await recordConflict(db, actor, deviceId, sale, "PRICE_CHANGED", details);
    return { idempotencyKey: key, status: "conflict", reason: "PRICE_CHANGED", message: "Prices changed since this sale was made offline" };
  }

  try {
    const result = await checkout(
      db,
      actor,
      {
        idempotencyKey: key,
        customerId: sale.customerId,
        items: sale.items.map((i) => ({ productId: i.productId, quantity: i.quantity, discount: i.discount })),
        cartDiscount: sale.cartDiscount,
        payments: sale.payments,
        notes: sale.notes ?? null,
        source: "OFFLINE",
        deviceId,
        clientCreatedAt: new Date(sale.clientCreatedAt),
      },
      { canOverrideDiscount: actor.canOverrideDiscount },
    );
    return { idempotencyKey: key, status: "synced", saleId: result.saleId, saleNumber: result.saleNumber, duplicate: result.duplicate };
  } catch (error) {
    if (isAppError(error)) {
      const reason = error.code === "INSUFFICIENT_STOCK" ? "INSUFFICIENT_STOCK" : error.code === "NOT_FOUND" ? "MISSING_DATA" : "VALIDATION";
      await recordConflict(db, actor, deviceId, sale, reason, { message: error.message, ...(error.details ?? {}) });
      return { idempotencyKey: key, status: "conflict", reason, message: error.message };
    }
    console.error("[sync] unexpected error", error);
    return { idempotencyKey: key, status: "retry", message: "Temporary server problem; will retry" };
  }
}

export async function touchDevice(db: DbClient, deviceId: string, userId: string, label: string | null) {
  await db
    .insert(syncDevices)
    .values({ id: deviceId, label, lastSyncAt: new Date(), lastUserId: userId })
    .onConflictDoUpdate({ target: syncDevices.id, set: { lastSyncAt: new Date(), lastUserId: userId, label } });
}

export async function listSyncConflicts(db: DbClient, status: "PENDING" | "ALL" = "PENDING") {
  return db
    .select({ conflict: syncConflicts, submittedByName: users.fullName })
    .from(syncConflicts)
    .leftJoin(users, eq(users.id, syncConflicts.submittedBy))
    .where(status === "PENDING" ? eq(syncConflicts.status, "PENDING") : undefined)
    .orderBy(desc(syncConflicts.createdAt))
    .limit(200);
}

/**
 * Owner decision on a conflict. "record" books the sale exactly as made offline (offline prices, may take stock below
 * zero — the shortfall then shows in inventory for a stock count). "dismiss" keeps the conflict as a permanent record.
 */
export async function resolveSyncConflict(
  db: Database,
  reviewer: Actor,
  input: { conflictId: string; decision: "record" | "dismiss"; note: string },
): Promise<{ saleId: string | null }> {
  const [conflict] = await db.select().from(syncConflicts).where(eq(syncConflicts.id, input.conflictId));
  if (!conflict) throw notFound("Conflict");
  if (conflict.status !== "PENDING") throw new AppError("CONFLICT", "This conflict has already been resolved");
  const sale = conflict.payload as OfflineSalePayload;

  let saleId: string | null = null;
  if (input.decision === "record") {
    const result = await checkout(
      db,
      { id: conflict.submittedBy ?? reviewer.id, role: reviewer.role },
      {
        idempotencyKey: sale.idempotencyKey,
        customerId: sale.customerId,
        items: sale.items.map((i) => ({ productId: i.productId, quantity: i.quantity, discount: i.discount, unitPrice: i.unitPrice })),
        cartDiscount: sale.cartDiscount,
        payments: sale.payments,
        notes: [sale.notes, `Offline conflict approved: ${input.note}`].filter(Boolean).join(" · "),
        source: "OFFLINE",
        deviceId: conflict.deviceId,
        clientCreatedAt: new Date(sale.clientCreatedAt),
      },
      { canOverrideDiscount: true, useClientPrices: true, allowNegativeStock: true },
    );
    saleId = result.saleId;
  }
  await db.transaction(async (tx: Tx) => {
    await tx
      .update(syncConflicts)
      .set({ status: input.decision === "record" ? "RESOLVED_RECORDED" : "DISMISSED", saleId, resolvedBy: reviewer.id, resolvedAt: new Date(), resolutionNote: input.note })
      .where(and(eq(syncConflicts.id, conflict.id), eq(syncConflicts.status, "PENDING")));
    await recordAudit(tx, { userId: reviewer.id, action: `sync_conflict.${input.decision}`, entityType: "sync_conflict", entityId: conflict.id, reason: input.note, after: { saleId } });
  });
  return { saleId };
}
