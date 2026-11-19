import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db/client";
import { sales, syncConflicts } from "@/server/db/schema";
import { findLedgerMismatches } from "@/server/services/inventory";
import { createProduct, getProduct, updateProduct } from "@/server/services/products";
import { listSyncConflicts, resolveSyncConflict, syncOfflineSale, type OfflineSalePayload } from "@/server/services/sync";
import { actor, createTestUser } from "../support/factories";
import { resetDatabase } from "../support/db";

const db = () => getDb();

async function setup(stock = 3) {
  const user = await createTestUser("CASHIER");
  const owner = await createTestUser("OWNER");
  const a = { ...actor(user), canOverrideDiscount: false };
  const p = await db().transaction((tx) =>
    createProduct(tx, actor(owner), { name: "Throw", sku: "T-1", barcode: null, categoryId: null, supplierId: null, description: null, costPrice: 2000, sellingPrice: 5000, reorderThreshold: 0, imageKey: null, initialStock: stock }),
  );
  const sale = (key: string, quantity = 1, unitPrice = 5000): OfflineSalePayload => ({
    idempotencyKey: key,
    customerId: null,
    items: [{ productId: p.id, quantity, discount: 0, unitPrice }],
    cartDiscount: 0,
    payments: [{ method: "CASH", amount: quantity * unitPrice }],
    clientCreatedAt: new Date().toISOString(),
  });
  return { a, owner, productId: p.id, sale };
}

describe("offline synchronisation", () => {
  beforeEach(resetDatabase);
  afterAll(closeDb);

  it("records valid offline sales once, even when the upload is retried", async () => {
    const { a, sale, productId } = await setup();
    const first = await syncOfflineSale(db(), a, "device-1", sale("off-1"));
    const retry = await syncOfflineSale(db(), a, "device-1", sale("off-1"));
    expect(first).toMatchObject({ status: "synced", duplicate: false });
    expect(retry).toMatchObject({ status: "synced", duplicate: true });
    expect(await db().select().from(sales)).toHaveLength(1);
    const [row] = await db().select().from(sales);
    expect(row).toMatchObject({ source: "OFFLINE", deviceId: "device-1" });
    expect((await getProduct(db(), productId)).quantity).toBe(2);
  });

  it("flags stock conflicts for review instead of overselling or discarding", async () => {
    const { a, sale, productId } = await setup(1);
    await syncOfflineSale(db(), a, "device-1", sale("off-a"));
    const outcome = await syncOfflineSale(db(), a, "device-2", sale("off-b"));
    expect(outcome).toMatchObject({ status: "conflict", reason: "INSUFFICIENT_STOCK" });
    expect((await getProduct(db(), productId)).quantity).toBe(0);
    const pending = await listSyncConflicts(db());
    expect(pending).toHaveLength(1);
    expect(await syncOfflineSale(db(), a, "device-2", sale("off-b"))).toMatchObject({ status: "conflict" });
  });

  it("flags price changes and lets the owner record the sale as made offline", async () => {
    const { a, owner, sale, productId } = await setup(5);
    await db().transaction((tx) =>
      updateProduct(tx, actor(owner), productId, { name: "Throw", sku: "T-1", barcode: null, categoryId: null, supplierId: null, description: null, costPrice: 2000, sellingPrice: 6000, reorderThreshold: 0, imageKey: null }),
    );
    const outcome = await syncOfflineSale(db(), a, "device-1", sale("off-price", 2));
    expect(outcome).toMatchObject({ status: "conflict", reason: "PRICE_CHANGED" });
    const [conflict] = await listSyncConflicts(db());

    const { saleId } = await resolveSyncConflict(db(), actor(owner), { conflictId: conflict.conflict.id, decision: "record", note: "Customer paid the old price" });
    const [recorded] = await db().select().from(sales).where(eq(sales.id, saleId!));
    expect(recorded).toMatchObject({ total: 10000, source: "OFFLINE", createdBy: a.id });
    expect((await db().select().from(syncConflicts))[0]).toMatchObject({ status: "RESOLVED_RECORDED", saleId });
    expect(await syncOfflineSale(db(), a, "device-1", sale("off-price", 2))).toMatchObject({ status: "synced", duplicate: true });
    expect(await findLedgerMismatches(db())).toEqual([]);
  });

  it("keeps dismissed conflicts as a permanent record", async () => {
    const { a, owner, sale } = await setup(0);
    await syncOfflineSale(db(), a, "device-1", sale("off-x"));
    const [conflict] = await listSyncConflicts(db());
    await resolveSyncConflict(db(), actor(owner), { conflictId: conflict.conflict.id, decision: "dismiss", note: "Duplicate entry on paper" });
    expect(await listSyncConflicts(db())).toHaveLength(0);
    expect(await listSyncConflicts(db(), "ALL")).toHaveLength(1);
    await expect(resolveSyncConflict(db(), actor(owner), { conflictId: conflict.conflict.id, decision: "record", note: "x" })).rejects.toThrow(/already been resolved/);
  });
});
