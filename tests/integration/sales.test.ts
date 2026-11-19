import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { dayRange, todayBusinessDate } from "@/lib/dates";
import { closeDb, getDb } from "@/server/db/client";
import { businessSettings, payments, saleItems } from "@/server/db/schema";
import { createCustomer } from "@/server/services/customers";
import { findLedgerMismatches } from "@/server/services/inventory";
import { getSaleBalance, recordSalePayment, reversePayment } from "@/server/services/payments";
import { createProduct, getPosCatalog, getProduct, updateProduct } from "@/server/services/products";
import { getFinancialSummary, getReceivables } from "@/server/services/reports/financials";
import { createReturn } from "@/server/services/returns";
import { checkout, getSale, priceCart, saleMovementTotal, settleTenders, voidSale } from "@/server/services/sales";
import { actor, createTestUser } from "../support/factories";
import { resetDatabase } from "../support/db";

const db = () => getDb();
const today = todayBusinessDate();
const owner = { canOverrideDiscount: true };
const cashier = { canOverrideDiscount: false };
let keyCounter = 0;
const key = () => `test-${Date.now()}-${(keyCounter += 1)}`;

async function setup() {
  const user = await createTestUser("OWNER");
  const a = actor(user);
  const base = { barcode: null, categoryId: null, supplierId: null, description: null, reorderThreshold: 1, imageKey: null };
  const vase = await db().transaction((tx) => createProduct(tx, a, { ...base, name: "Vase", sku: "V-1", costPrice: 6000, sellingPrice: 10000, initialStock: 5 }));
  const lamp = await db().transaction((tx) => createProduct(tx, a, { ...base, name: "Lamp", sku: "L-1", costPrice: 12000, sellingPrice: 20000, initialStock: 2 }));
  const customer = await db().transaction((tx) => createCustomer(tx, a, { fullName: "Esi Owusu", phone: "0201112222", email: null, address: null, notes: null }));
  return { user, a, vaseId: vase.id, lampId: lamp.id, customerId: customer.id };
}

describe("cart pricing", () => {
  it("spreads a cart discount over lines and applies tax per line", () => {
    const cart = priceCart(
      [
        { productId: "a", quantity: 2, unitPrice: 10000, discount: 0 },
        { productId: "b", quantity: 1, unitPrice: 20000, discount: 2000 },
      ],
      3800,
      1250,
    );
    // nets before cart discount: 20000 and 18000 → shares 2000 and 1800
    expect(cart.lines.map((l) => l.totalDiscount)).toEqual([2000, 3800]);
    expect(cart.lines.map((l) => l.tax)).toEqual([2250, 2025]);
    expect(cart).toMatchObject({ subtotal: 40000, discountTotal: 5800, taxTotal: 4275, total: 38475 });
    expect(cart.lines.reduce((s, l) => s + l.lineTotal, 0)).toBe(cart.total);
  });

  it("rejects discounts larger than the value", () => {
    expect(() => priceCart([{ productId: "a", quantity: 1, unitPrice: 100, discount: 101 }], 0, 0)).toThrow();
    expect(() => priceCart([{ productId: "a", quantity: 1, unitPrice: 100, discount: 0 }], 101, 0)).toThrow();
  });

  it("returns cash change and refuses over-tendering by mobile money", () => {
    expect(settleTenders(9000, [{ method: "CASH", amount: 10000 }])).toEqual({ recorded: [{ method: "CASH", amount: 9000 }], paid: 9000, change: 1000 });
    expect(settleTenders(9000, [{ method: "MTN_MOMO", amount: 5000 }, { method: "CASH", amount: 5000 }]).change).toBe(1000);
    expect(() => settleTenders(9000, [{ method: "MTN_MOMO", amount: 10000 }])).toThrow(/Only cash/);
  });
});

describe("checkout", () => {
  beforeEach(resetDatabase);
  afterAll(closeDb);

  it("records a fully paid sale atomically with snapshots, stock movements and payments", async () => {
    const { a, vaseId } = await setup();
    const result = await checkout(db(), a, { idempotencyKey: key(), customerId: null, items: [{ productId: vaseId, quantity: 2 }], payments: [{ method: "CASH", amount: 25000 }] }, owner);
    expect(result).toMatchObject({ total: 20000, paid: 20000, change: 5000, balance: 0, duplicate: false });
    expect(result.saleNumber).toMatch(/^SAL-\d{6}$/);

    const sale = await getSale(db(), result.saleId);
    expect(sale.items[0]).toMatchObject({ productName: "Vase", sku: "V-1", quantity: 2, unitCost: 6000, unitPrice: 10000, lineTotal: 20000 });
    expect(sale.costTotal).toBe(12000);
    expect(sale.payments).toHaveLength(1);
    expect((await getProduct(db(), vaseId)).quantity).toBe(3);
    expect(await saleMovementTotal(db(), result.saleId)).toBe(-2);
  });

  it("keeps historical snapshots when the product changes later", async () => {
    const { a, vaseId } = await setup();
    const { saleId } = await checkout(db(), a, { idempotencyKey: key(), customerId: null, items: [{ productId: vaseId, quantity: 1 }], payments: [{ method: "CASH", amount: 10000 }] }, owner);
    await db().transaction((tx) =>
      updateProduct(tx, a, vaseId, { name: "Renamed vase", sku: "V-NEW", barcode: null, categoryId: null, supplierId: null, description: null, costPrice: 9000, sellingPrice: 15000, reorderThreshold: 1, imageKey: null }),
    );
    const [item] = await db().select().from(saleItems).where(eq(saleItems.saleId, saleId));
    expect(item).toMatchObject({ productName: "Vase", sku: "V-1", unitPrice: 10000, unitCost: 6000 });
  });

  it("supports partial payments for named customers and later balance payments", async () => {
    const { a, lampId, customerId } = await setup();
    await expect(
      checkout(db(), a, { idempotencyKey: key(), customerId: null, items: [{ productId: lampId, quantity: 1 }], payments: [{ method: "CASH", amount: 5000 }] }, owner),
    ).rejects.toThrow(/Select a customer/);

    const { saleId, balance } = await checkout(
      db(),
      a,
      { idempotencyKey: key(), customerId, items: [{ productId: lampId, quantity: 1 }], payments: [{ method: "MTN_MOMO", amount: 5000, externalReference: "TX1" }] },
      owner,
    );
    expect(balance).toBe(15000);
    expect((await getReceivables(db())).sales).toBe(15000);

    await expect(db().transaction((tx) => recordSalePayment(tx, a, { saleId, amount: 15001, method: "CASH", externalReference: null, notes: null }))).rejects.toThrow(/more than the balance/);
    await db().transaction((tx) => recordSalePayment(tx, a, { saleId, amount: 15000, method: "CASH", externalReference: null, notes: null }));
    expect((await getSaleBalance(db(), saleId)).balance).toBe(0);
  });

  it("accepts several payment methods in one sale", async () => {
    const { a, vaseId, lampId } = await setup();
    const result = await checkout(
      db(),
      a,
      {
        idempotencyKey: key(),
        customerId: null,
        items: [{ productId: vaseId, quantity: 1 }, { productId: lampId, quantity: 1 }],
        payments: [{ method: "TELECEL_CASH", amount: 10000 }, { method: "CARD", amount: 15000 }, { method: "CASH", amount: 10000 }],
      },
      owner,
    );
    expect(result).toMatchObject({ total: 30000, paid: 30000, change: 5000 });
    const rows = await db().select().from(payments).where(eq(payments.saleId, result.saleId));
    expect(rows.map((r) => [r.method, r.amount]).sort()).toEqual([["CARD", 15000], ["CASH", 5000], ["TELECEL_CASH", 10000]]);
  });

  it("enforces the cashier discount limit unless overridden", async () => {
    const { a, vaseId } = await setup();
    const input = { customerId: null, items: [{ productId: vaseId, quantity: 1, discount: 2000 }], payments: [{ method: "CASH" as const, amount: 8000 }] };
    await expect(checkout(db(), a, { ...input, idempotencyKey: key() }, cashier)).rejects.toThrow(/need a manager/);
    const ok = await checkout(db(), a, { ...input, idempotencyKey: key() }, owner);
    expect(ok.total).toBe(8000);
  });

  it("never records the same checkout twice (double click, retry, refresh)", async () => {
    const { a, vaseId } = await setup();
    const input = { idempotencyKey: key(), customerId: null, items: [{ productId: vaseId, quantity: 1 }], payments: [{ method: "CASH" as const, amount: 10000 }] };
    const [first, second, third] = await Promise.all([checkout(db(), a, input, owner), checkout(db(), a, input, owner), checkout(db(), a, input, owner)]);
    expect(new Set([first.saleId, second.saleId, third.saleId]).size).toBe(1);
    expect([first, second, third].filter((r) => !r.duplicate)).toHaveLength(1);
    expect((await getProduct(db(), vaseId)).quantity).toBe(4);
    expect(await db().select().from(payments)).toHaveLength(1);
  });

  it("handles concurrent checkouts from several devices without overselling", async () => {
    const { a, lampId } = await setup();
    const attempts = Array.from({ length: 5 }, () =>
      checkout(db(), a, { idempotencyKey: key(), customerId: null, items: [{ productId: lampId, quantity: 1 }], payments: [{ method: "CASH", amount: 20000 }] }, owner),
    );
    const results = await Promise.allSettled(attempts);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const lamp = await getProduct(db(), lampId);
    expect(lamp).toMatchObject({ quantity: 0, status: "OUT_OF_STOCK" });
    expect((await getPosCatalog(db())).find((p) => p.id === lampId)).toBeUndefined();
    expect(await findLedgerMismatches(db())).toEqual([]);
  });

  it("applies the configured sales tax", async () => {
    const { a, vaseId } = await setup();
    await db().update(businessSettings).set({ taxRateBps: 1500 });
    const result = await checkout(db(), a, { idempotencyKey: key(), customerId: null, items: [{ productId: vaseId, quantity: 1 }], payments: [{ method: "CASH", amount: 11500 }] }, owner);
    expect(result.total).toBe(11500);
    const summary = await getFinancialSummary(db(), dayRange(today));
    expect(summary).toMatchObject({ grossSales: 10000, taxCollected: 1500, netRevenue: 10000 });
  });
});

describe("returns, refunds and voids", () => {
  beforeEach(resetDatabase);
  afterAll(closeDb);

  it("restocks accepted returns, reduces revenue and COGS, and caps refunds", async () => {
    const { a, vaseId } = await setup();
    const { saleId } = await checkout(db(), a, { idempotencyKey: key(), customerId: null, items: [{ productId: vaseId, quantity: 3 }], cartDiscount: 3000, payments: [{ method: "CASH", amount: 27000 }] }, owner);
    const sale = await getSale(db(), saleId);
    const itemId = sale.items[0].id;

    await expect(
      db().transaction((tx) => createReturn(tx, a, { saleId, idempotencyKey: key(), reason: "Wrong colour", items: [{ saleItemId: itemId, quantity: 1, restock: true }], refund: { method: "CASH", amount: 9001 } })),
    ).rejects.toThrow(/at most/);

    const result = await db().transaction((tx) =>
      createReturn(tx, a, { saleId, idempotencyKey: key(), reason: "Wrong colour", items: [{ saleItemId: itemId, quantity: 1, restock: true }], refund: { method: "CASH", amount: 9000 } }),
    );
    expect(result).toMatchObject({ value: 9000, refunded: 9000 });
    expect((await getProduct(db(), vaseId)).quantity).toBe(3); // 5 − 3 + 1

    const summary = await getFinancialSummary(db(), dayRange(today));
    expect(summary).toMatchObject({ grossSales: 27000, returns: 9000, netRevenue: 18000, cogs: 12000, grossProfit: 6000, cashCollected: 18000 });
    expect((await getSaleBalance(db(), saleId)).balance).toBe(0);
  });

  it("keeps COGS for damaged returns that are not restocked", async () => {
    const { a, vaseId } = await setup();
    const { saleId } = await checkout(db(), a, { idempotencyKey: key(), customerId: null, items: [{ productId: vaseId, quantity: 1 }], payments: [{ method: "CASH", amount: 10000 }] }, owner);
    const itemId = (await getSale(db(), saleId)).items[0].id;
    await db().transaction((tx) => createReturn(tx, a, { saleId, idempotencyKey: key(), reason: "Broken", items: [{ saleItemId: itemId, quantity: 1, restock: false }], refund: { method: "CASH", amount: 10000 } }));
    expect((await getProduct(db(), vaseId)).quantity).toBe(4);
    const summary = await getFinancialSummary(db(), dayRange(today));
    expect(summary).toMatchObject({ netRevenue: 0, cogs: 6000, grossProfit: -6000 });
  });

  it("never returns more than was sold and splits partial returns exactly", async () => {
    const { a, vaseId } = await setup();
    const { saleId } = await checkout(db(), a, { idempotencyKey: key(), customerId: null, items: [{ productId: vaseId, quantity: 3 }], cartDiscount: 1000, payments: [{ method: "CASH", amount: 29000 }] }, owner);
    const itemId = (await getSale(db(), saleId)).items[0].id;
    const values: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const r = await db().transaction((tx) => createReturn(tx, a, { saleId, idempotencyKey: key(), reason: "Return", items: [{ saleItemId: itemId, quantity: 1, restock: true }], refund: null }));
      values.push(r.value);
    }
    expect(values.reduce((s, v) => s + v, 0)).toBe(29000);
    await expect(
      db().transaction((tx) => createReturn(tx, a, { saleId, idempotencyKey: key(), reason: "Again", items: [{ saleItemId: itemId, quantity: 1, restock: true }], refund: null })),
    ).rejects.toThrow(/Only 0/);
  });

  it("voids a sale: restores stock, reverses payments and removes it from revenue", async () => {
    const { a, lampId } = await setup();
    const { saleId } = await checkout(db(), a, { idempotencyKey: key(), customerId: null, items: [{ productId: lampId, quantity: 2 }], payments: [{ method: "CASH", amount: 40000 }] }, owner);
    expect((await getProduct(db(), lampId)).status).toBe("OUT_OF_STOCK");

    await db().transaction((tx) => voidSale(tx, a, { saleId, reason: "Entered twice" }));
    const lamp = await getProduct(db(), lampId);
    expect(lamp).toMatchObject({ quantity: 2, status: "ACTIVE" });
    const summary = await getFinancialSummary(db(), dayRange(today));
    expect(summary).toMatchObject({ grossSales: 0, cogs: 0, cashCollected: 0 });
    await expect(db().transaction((tx) => voidSale(tx, a, { saleId, reason: "again" }))).rejects.toThrow(/already voided/);
    expect(await findLedgerMismatches(db())).toEqual([]);
  });

  it("reverses a mistaken payment without editing the original", async () => {
    const { a, vaseId, customerId } = await setup();
    const { saleId } = await checkout(db(), a, { idempotencyKey: key(), customerId, items: [{ productId: vaseId, quantity: 1 }], payments: [{ method: "BANK_TRANSFER", amount: 10000 }] }, owner);
    const [receipt] = await db().select().from(payments).where(eq(payments.saleId, saleId));
    await db().transaction((tx) => reversePayment(tx, a, { paymentId: receipt.id, reason: "Transfer bounced" }));
    expect((await getSaleBalance(db(), saleId)).balance).toBe(10000);
    const rows = await db().select().from(payments).where(eq(payments.saleId, saleId));
    expect(rows.find((r) => r.id === receipt.id)?.amount).toBe(10000);
    expect(rows.find((r) => r.kind === "REVERSAL")?.amount).toBe(-10000);
    await expect(db().transaction((tx) => reversePayment(tx, a, { paymentId: receipt.id, reason: "x" }))).rejects.toThrow(/already been reversed/);
  });
});
