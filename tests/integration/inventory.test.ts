import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db/client";
import { auditLogs, businessSettings, inventoryMovements, productPriceChanges, products } from "@/server/db/schema";
import {
  adjustStock,
  applyStockChange,
  findLedgerMismatches,
  listMovements,
  nextStockStatus,
  receiveStock,
  weightedAverageCost,
} from "@/server/services/inventory";
import { archiveProduct, createProduct, getPosCatalog, getProduct, getProductStats, reactivateProduct } from "@/server/services/products";
import { actor, createTestUser } from "../support/factories";
import { resetDatabase } from "../support/db";

const db = () => getDb();

async function setup(initialStock = 5) {
  const owner = await createTestUser("OWNER");
  const created = await db().transaction((tx) =>
    createProduct(tx, actor(owner), {
      name: "Gold mirror",
      sku: "mir-01",
      barcode: null,
      categoryId: null,
      supplierId: null,
      description: null,
      costPrice: 20000,
      sellingPrice: 35000,
      reorderThreshold: 2,
      imageKey: null,
      initialStock,
    }),
  );
  return { owner, productId: created.id };
}

describe("inventory ledger", () => {
  beforeEach(resetDatabase);
  afterAll(closeDb);

  it("records opening stock as an INITIAL_STOCK movement", async () => {
    const { productId } = await setup(5);
    const product = await getProduct(db(), productId);
    expect(product).toMatchObject({ sku: "MIR-01", quantity: 5, initialStock: 5, status: "ACTIVE" });
    const { rows } = await listMovements(db(), { productId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "INITIAL_STOCK", quantityChange: 5, previousQuantity: 0, newQuantity: 5, unitCost: 20000 });
  });

  it("automatically archives a product when a sale takes stock to zero, keeping its history", async () => {
    const { owner, productId } = await setup(2);
    const result = await db().transaction((tx) =>
      applyStockChange(tx, { productId, type: "SALE", quantityChange: -2, userId: owner.id, referenceType: "sale" }),
    );
    expect(result).toMatchObject({ newQuantity: 0, status: "OUT_OF_STOCK", becameOutOfStock: true });

    const product = await getProduct(db(), productId);
    expect(product.status).toBe("OUT_OF_STOCK");
    expect(product.outOfStockAt).toBeInstanceOf(Date);
    expect(product.sku).toBe("MIR-01");
    expect(product.costPrice).toBe(20000);
    expect((await getPosCatalog(db())).map((p) => p.id)).not.toContain(productId);
    expect((await listMovements(db(), { productId })).rows).toHaveLength(2);
    const audit = await db().select().from(auditLogs).where(eq(auditLogs.action, "product.out_of_stock"));
    expect(audit).toHaveLength(1);
  });

  it("prevents negative stock unless the business setting allows it", async () => {
    const { owner, productId } = await setup(1);
    await expect(
      db().transaction((tx) => applyStockChange(tx, { productId, type: "SALE", quantityChange: -2, userId: owner.id })),
    ).rejects.toThrow(/Only 1/);
    expect((await getProduct(db(), productId)).quantity).toBe(1);

    await db().update(businessSettings).set({ allowNegativeStock: true });
    const result = await db().transaction((tx) => applyStockChange(tx, { productId, type: "SALE", quantityChange: -2, userId: owner.id }));
    expect(result.newQuantity).toBe(-1);
  });

  it("restocks and reactivates the same product record with weighted-average cost", async () => {
    const { owner, productId } = await setup(2);
    await db().transaction((tx) => applyStockChange(tx, { productId, type: "SALE", quantityChange: -2, userId: owner.id }));

    const result = await db().transaction((tx) =>
      receiveStock(tx, { productId, quantity: 4, unitCost: 26000, userId: owner.id, reason: "Restock" }),
    );
    expect(result).toMatchObject({ newQuantity: 4, status: "ACTIVE", reactivated: true });
    const product = await getProduct(db(), productId);
    expect(product.costPrice).toBe(26000); // no stock left, so the new cost replaces the old one
    expect(product.outOfStockAt).toBeNull();
    expect(await db().select().from(products)).toHaveLength(1);

    await db().transaction((tx) => receiveStock(tx, { productId, quantity: 4, unitCost: 30000, userId: owner.id }));
    expect((await getProduct(db(), productId)).costPrice).toBe(28000); // (4×260 + 4×300) / 8
    expect(await db().select().from(productPriceChanges).where(eq(productPriceChanges.productId, productId))).toHaveLength(2);
  });

  it("does not let stock changes un-archive a manually archived product unless asked", async () => {
    const { owner, productId } = await setup(3);
    await db().transaction((tx) => archiveProduct(tx, actor(owner), { id: productId, reason: "Seasonal", discontinue: false }));
    await db().transaction((tx) => receiveStock(tx, { productId, quantity: 1, unitCost: 20000, userId: owner.id }));
    expect((await getProduct(db(), productId)).status).toBe("ARCHIVED");

    await db().transaction((tx) => receiveStock(tx, { productId, quantity: 1, unitCost: 20000, userId: owner.id, reactivate: true }));
    const product = await getProduct(db(), productId);
    expect(product.status).toBe("ACTIVE");
    expect(product.archivedAt).toBeNull();
  });

  it("records damage, loss and manual adjustments with mandatory reasons", async () => {
    const { owner, productId } = await setup(10);
    await db().transaction((tx) =>
      adjustStock(tx, actor(owner), { productId, kind: "DAMAGE", quantity: 2, direction: "increase", reason: "Broken in transit" }),
    );
    await db().transaction((tx) => adjustStock(tx, actor(owner), { productId, kind: "LOSS", quantity: 1, direction: "decrease", reason: "Missing" }));
    await db().transaction((tx) =>
      adjustStock(tx, actor(owner), { productId, kind: "MANUAL_ADJUSTMENT", quantity: 3, direction: "increase", reason: "Stock count" }),
    );
    await expect(
      db().transaction((tx) => adjustStock(tx, actor(owner), { productId, kind: "LOSS", quantity: 1, direction: "decrease", reason: "" })),
    ).rejects.toThrow(/reason/);

    expect((await getProduct(db(), productId)).quantity).toBe(10); // 10 − 2 (damage always removes) − 1 + 3
    const types = (await listMovements(db(), { productId })).rows.map((r) => [r.type, r.quantityChange]);
    expect(types).toEqual([
      ["MANUAL_ADJUSTMENT", 3],
      ["LOSS", -1],
      ["DAMAGE", -2],
      ["INITIAL_STOCK", 10],
    ]);
    expect(await findLedgerMismatches(db())).toEqual([]);
  });

  it("never oversells when many devices sell the last units at the same time", async () => {
    const { owner, productId } = await setup(5);
    const attempts = Array.from({ length: 12 }, () =>
      db().transaction((tx) => applyStockChange(tx, { productId, type: "SALE", quantityChange: -1, userId: owner.id })),
    );
    const results = await Promise.allSettled(attempts);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    const product = await getProduct(db(), productId);
    expect(product).toMatchObject({ quantity: 0, status: "OUT_OF_STOCK" });
    const sales = await db().select().from(inventoryMovements).where(eq(inventoryMovements.type, "SALE"));
    expect(sales).toHaveLength(5);
    expect(await findLedgerMismatches(db())).toEqual([]);
  });

  it("computes lifetime product statistics from the ledger", async () => {
    const { owner, productId } = await setup(5);
    await db().transaction((tx) => receiveStock(tx, { productId, quantity: 3, unitCost: 20000, userId: owner.id }));
    await db().transaction((tx) => applyStockChange(tx, { productId, type: "SALE", quantityChange: -4, userId: owner.id }));
    const stats = await getProductStats(db(), productId);
    expect(stats).toMatchObject({ initialStock: 5, purchased: 3, sold: 4, writtenOff: 0 });
  });

  it("reactivates a manually archived product without stock as OUT_OF_STOCK", async () => {
    const { owner, productId } = await setup(0);
    await db().transaction((tx) => archiveProduct(tx, actor(owner), { id: productId, reason: "Discontinued line", discontinue: true }));
    expect((await getProduct(db(), productId)).status).toBe("DISCONTINUED");
    expect(await db().transaction((tx) => reactivateProduct(tx, actor(owner), productId))).toBe("OUT_OF_STOCK");
  });
});

describe("stock helpers", () => {
  it("computes weighted-average cost with rounding", () => {
    expect(weightedAverageCost(3, 1000, 1, 2000)).toBe(1250);
    expect(weightedAverageCost(0, 1000, 5, 1500)).toBe(1500);
    expect(weightedAverageCost(-2, 1000, 5, 1500)).toBe(1500);
    expect(weightedAverageCost(1, 1, 2, 2)).toBe(2); // 5/3 = 1.67 → 2
  });

  it("transitions statuses correctly", () => {
    expect(nextStockStatus("ACTIVE", 0).status).toBe("OUT_OF_STOCK");
    expect(nextStockStatus("OUT_OF_STOCK", 3).status).toBe("ACTIVE");
    expect(nextStockStatus("ARCHIVED", 3).status).toBe("ARCHIVED");
    expect(nextStockStatus("DISCONTINUED", 3, true).status).toBe("ACTIVE");
    expect(nextStockStatus("ARCHIVED", 0, true).status).toBe("ARCHIVED");
  });
});
