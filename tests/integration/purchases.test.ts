import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { dayRange, todayBusinessDate } from "@/lib/dates";
import { closeDb, getDb } from "@/server/db/client";
import { applyStockChange, findLedgerMismatches, listMovements } from "@/server/services/inventory";
import { createProduct, getProduct } from "@/server/services/products";
import {
  cancelPurchase,
  createPurchase,
  getPurchase,
  listPurchases,
  receivePurchase,
  recordSupplierPayment,
  reverseSupplierPayment,
  updateDraftPurchase,
} from "@/server/services/purchases";
import { getFinancialSummary } from "@/server/services/reports/financials";
import { createSupplier, getSupplier } from "@/server/services/suppliers";
import { actor, createTestUser } from "../support/factories";
import { resetDatabase } from "../support/db";

const db = () => getDb();
const today = todayBusinessDate();

async function setup() {
  const owner = await createTestUser("OWNER");
  const a = actor(owner);
  const supplier = await db().transaction((tx) =>
    createSupplier(tx, a, { name: "Kumasi Crafts", contactPerson: "Yaw", phone: "0244000000", email: null, address: null, notes: null }),
  );
  const base = { barcode: null, categoryId: null, supplierId: supplier.id, description: null, reorderThreshold: 2, imageKey: null };
  const vase = await db().transaction((tx) =>
    createProduct(tx, a, { ...base, name: "Vase", sku: "V-1", costPrice: 10000, sellingPrice: 18000, initialStock: 2 }),
  );
  const rug = await db().transaction((tx) =>
    createProduct(tx, a, { ...base, name: "Rug", sku: "R-1", costPrice: 30000, sellingPrice: 50000, initialStock: 0 }),
  );
  return { owner, a, supplierId: supplier.id, vaseId: vase.id, rugId: rug.id };
}

describe("suppliers and stock purchases", () => {
  beforeEach(resetDatabase);
  afterAll(closeDb);

  it("creates a draft that does not touch stock until received", async () => {
    const { a, supplierId, vaseId } = await setup();
    const purchase = await db().transaction((tx) =>
      createPurchase(tx, a, { supplierId, purchaseDate: today, supplierReference: "INV-77", notes: null, items: [{ productId: vaseId, quantity: 3, unitCost: 13000 }] }),
    );
    expect(purchase.purchaseNumber).toMatch(/^PUR-\d{6}$/);
    expect((await getProduct(db(), vaseId)).quantity).toBe(2);
    expect((await getPurchase(db(), purchase.id)).total).toBe(39000);
  });

  it("receives stock with weighted-average cost and reactivates sold-out products", async () => {
    const { a, supplierId, vaseId, rugId } = await setup();
    const { id } = await db().transaction((tx) =>
      createPurchase(tx, a, {
        supplierId,
        purchaseDate: today,
        supplierReference: null,
        notes: null,
        items: [
          { productId: vaseId, quantity: 2, unitCost: 14000 },
          { productId: rugId, quantity: 1, unitCost: 32000 },
        ],
      }),
    );
    await db().transaction((tx) => receivePurchase(tx, a, id));

    const vase = await getProduct(db(), vaseId);
    expect(vase).toMatchObject({ quantity: 4, costPrice: 12000 }); // (2×100 + 2×140) / 4
    const rug = await getProduct(db(), rugId);
    expect(rug).toMatchObject({ quantity: 1, status: "ACTIVE", costPrice: 32000 });
    const movements = (await listMovements(db(), { productId: vaseId })).rows;
    expect(movements[0]).toMatchObject({ type: "PURCHASE", quantityChange: 2, unitCost: 14000, referenceType: "purchase", referenceId: id });
    expect(await findLedgerMismatches(db())).toEqual([]);

    await expect(db().transaction((tx) => receivePurchase(tx, a, id))).rejects.toThrow(/already received/);
    await expect(db().transaction((tx) => cancelPurchase(tx, a, id, "Oops"))).rejects.toThrow(/Only draft/);
  });

  it("does not count stock purchases as operating expenses or cost of goods sold", async () => {
    const { a, supplierId, vaseId } = await setup();
    const { id } = await db().transaction((tx) =>
      createPurchase(tx, a, { supplierId, purchaseDate: today, supplierReference: null, notes: null, items: [{ productId: vaseId, quantity: 10, unitCost: 10000 }] }),
    );
    await db().transaction((tx) => receivePurchase(tx, a, id));
    await db().transaction((tx) => recordSupplierPayment(tx, a, { purchaseId: id, amount: 100000, method: "BANK_TRANSFER", externalReference: null, notes: null }));
    const summary = await getFinancialSummary(db(), dayRange(today));
    expect(summary).toMatchObject({ operatingExpenses: 0, cogs: 0, netOperatingProfit: 0, cashCollected: 0 });
  });

  it("tracks supplier payments, prevents overpayment and supports reversals", async () => {
    const { a, supplierId, vaseId } = await setup();
    const { id } = await db().transaction((tx) =>
      createPurchase(tx, a, { supplierId, purchaseDate: today, supplierReference: null, notes: null, items: [{ productId: vaseId, quantity: 5, unitCost: 10000 }] }),
    );
    const payment = await db().transaction((tx) =>
      recordSupplierPayment(tx, a, { purchaseId: id, amount: 20000, method: "MTN_MOMO", externalReference: "MOMO123", notes: null }),
    );
    expect((await getPurchase(db(), id)).outstanding).toBe(30000);
    expect((await getSupplier(db(), supplierId)).outstanding).toBe(30000);

    await expect(
      db().transaction((tx) => recordSupplierPayment(tx, a, { purchaseId: id, amount: 30001, method: "CASH", externalReference: null, notes: null })),
    ).rejects.toThrow(/more than the outstanding/);

    await db().transaction((tx) => reverseSupplierPayment(tx, a, { paymentId: payment.id, reason: "Wrong purchase" }));
    const after = await getPurchase(db(), id);
    expect(after.outstanding).toBe(50000);
    expect(after.payments).toHaveLength(2);
    expect(after.payments[0].isReversed).toBe(true);
    await expect(db().transaction((tx) => reverseSupplierPayment(tx, a, { paymentId: payment.id, reason: "Again" }))).rejects.toThrow(/already been reversed/);
  });

  it("edits and cancels drafts only when no payments remain", async () => {
    const { a, supplierId, vaseId, rugId } = await setup();
    const { id } = await db().transaction((tx) =>
      createPurchase(tx, a, { supplierId, purchaseDate: today, supplierReference: null, notes: null, items: [{ productId: vaseId, quantity: 1, unitCost: 10000 }] }),
    );
    await db().transaction((tx) =>
      updateDraftPurchase(tx, a, id, { supplierId, purchaseDate: today, supplierReference: "X", notes: null, items: [{ productId: rugId, quantity: 2, unitCost: 25000 }] }),
    );
    expect((await getPurchase(db(), id)).total).toBe(50000);

    const payment = await db().transaction((tx) => recordSupplierPayment(tx, a, { purchaseId: id, amount: 5000, method: "CASH", externalReference: null, notes: null }));
    await expect(db().transaction((tx) => cancelPurchase(tx, a, id, "Not needed"))).rejects.toThrow(/Reverse the payments/);
    await db().transaction((tx) => reverseSupplierPayment(tx, a, { paymentId: payment.id, reason: "Refunded" }));
    await db().transaction((tx) => cancelPurchase(tx, a, id, "Not needed"));
    const list = await listPurchases(db(), { status: "CANCELLED" });
    expect(list.items[0]).toMatchObject({ id, outstanding: 0 });
  });

  it("rejects duplicate lines and empty purchases", async () => {
    const { a, supplierId, vaseId } = await setup();
    await expect(
      db().transaction((tx) => createPurchase(tx, a, { supplierId, purchaseDate: today, supplierReference: null, notes: null, items: [] })),
    ).rejects.toThrow(/at least one/);
    await expect(
      db().transaction((tx) =>
        createPurchase(tx, a, {
          supplierId,
          purchaseDate: today,
          supplierReference: null,
          notes: null,
          items: [
            { productId: vaseId, quantity: 1, unitCost: 1 },
            { productId: vaseId, quantity: 2, unitCost: 1 },
          ],
        }),
      ),
    ).rejects.toThrow(/only once/);
  });

  it("reactivates after a purchase even when the sale emptied stock moments before", async () => {
    const { owner, a, supplierId, vaseId } = await setup();
    await db().transaction((tx) => applyStockChange(tx, { productId: vaseId, type: "SALE", quantityChange: -2, userId: owner.id }));
    expect((await getProduct(db(), vaseId)).status).toBe("OUT_OF_STOCK");
    const { id } = await db().transaction((tx) =>
      createPurchase(tx, a, { supplierId, purchaseDate: today, supplierReference: null, notes: null, items: [{ productId: vaseId, quantity: 1, unitCost: 10000 }] }),
    );
    await db().transaction((tx) => receivePurchase(tx, a, id));
    expect((await getProduct(db(), vaseId)).status).toBe("ACTIVE");
  });
});
