import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { dayRange, todayBusinessDate } from "@/lib/dates";
import { closeDb, getDb } from "@/server/db/client";
import { expenseCategories, expenses } from "@/server/db/schema";
import { createCustomer, getCustomerSummary } from "@/server/services/customers";
import { createProduct, getProduct } from "@/server/services/products";
import { cancelOrder, completeOrder, createOrder, getOrder, listOrders, recordOrderPayment, setOrderStatus, updateOrder } from "@/server/services/orders";
import { listPayments } from "@/server/services/payments";
import { getFinancialSummary, getReceivables } from "@/server/services/reports/financials";
import { actor, createTestUser } from "../support/factories";
import { resetDatabase } from "../support/db";

const db = () => getDb();
const today = todayBusinessDate();

async function setup() {
  const user = await createTestUser("OWNER");
  const a = actor(user);
  const customer = await db().transaction((tx) => createCustomer(tx, a, { fullName: "Adwoa Asante", phone: "0245550000", email: null, address: null, notes: null }));
  const fabric = await db().transaction((tx) =>
    createProduct(tx, a, { name: "Velvet fabric (m)", sku: "FAB-1", barcode: null, categoryId: null, supplierId: null, description: null, costPrice: 4000, sellingPrice: 7000, reorderThreshold: 1, imageKey: null, initialStock: 10 }),
  );
  const base = {
    customerId: customer.id,
    title: "Living room curtains",
    description: null,
    estimatedMaterialsCost: 30000,
    estimatedLabourCost: 20000,
    expectedCompletionDate: today,
    fulfilment: "DELIVERY" as const,
    deliveryAddress: "East Legon",
    deliveryNotes: null,
    internalNotes: null,
    items: [
      { kind: "PRODUCT" as const, productId: fabric.id, description: "Velvet fabric", quantity: 5, unitPrice: 7000 },
      { kind: "SERVICE" as const, productId: null, description: "Sewing & installation", quantity: 1, unitPrice: 65000 },
    ],
  };
  return { a, customerId: customer.id, fabricId: fabric.id, base };
}

describe("customer orders", () => {
  beforeEach(resetDatabase);
  afterAll(closeDb);

  it("treats deposits as payments, not revenue, until the order is completed", async () => {
    const { a, base, fabricId } = await setup();
    const order = await db().transaction((tx) => createOrder(tx, a, base));
    expect(order.orderNumber).toMatch(/^ORD-\d{6}$/);
    expect((await getOrder(db(), order.id)).totalAmount).toBe(100000);

    await db().transaction((tx) => recordOrderPayment(tx, a, { orderId: order.id, amount: 40000, method: "MTN_MOMO", externalReference: "M1", notes: null }));
    const afterDeposit = await getOrder(db(), order.id);
    expect(afterDeposit).toMatchObject({ status: "DEPOSIT_PAID", paid: 40000, outstanding: 60000 });
    let summary = await getFinancialSummary(db(), dayRange(today));
    expect(summary).toMatchObject({ netRevenue: 0, cashCollected: 40000 });
    expect((await getProduct(db(), fabricId)).quantity).toBe(10);
    expect((await getReceivables(db())).openOrders).toBe(60000);

    await db().transaction((tx) => setOrderStatus(tx, a, order.id, "IN_PROGRESS"));
    await db().transaction((tx) => setOrderStatus(tx, a, order.id, "READY"));
    const [materials] = await db().select().from(expenseCategories).limit(1);
    await db().insert(expenses).values({ description: "Lining & thread", amount: 15000, categoryId: materials.id, expenseDate: today, paymentMethod: "CASH", orderId: order.id, createdBy: a.id });

    await db().transaction((tx) => completeOrder(tx, a, order.id));
    const done = await getOrder(db(), order.id);
    expect(done).toMatchObject({ status: "COMPLETED", productCostTotal: 20000, directCostTotal: 15000, actualProfit: 65000, estimatedProfit: 50000 });
    expect(done.items.find((i) => i.kind === "PRODUCT")?.unitCost).toBe(4000);
    expect((await getProduct(db(), fabricId)).quantity).toBe(5);

    summary = await getFinancialSummary(db(), dayRange(today));
    expect(summary).toMatchObject({ orderRevenue: 100000, netRevenue: 100000, cogs: 35000, grossProfit: 65000, operatingExpenses: 0 });
    expect((await getReceivables(db())).completedOrders).toBe(60000);
  });

  it("supports several payments and prevents overpaying", async () => {
    const { a, base } = await setup();
    const { id } = await db().transaction((tx) => createOrder(tx, a, base));
    await db().transaction((tx) => recordOrderPayment(tx, a, { orderId: id, amount: 30000, method: "CASH", externalReference: null, notes: null }));
    await db().transaction((tx) => recordOrderPayment(tx, a, { orderId: id, amount: 50000, method: "BANK_TRANSFER", externalReference: null, notes: null }));
    await expect(db().transaction((tx) => recordOrderPayment(tx, a, { orderId: id, amount: 20001, method: "CASH", externalReference: null, notes: null }))).rejects.toThrow(/more than the balance/);
    expect((await listPayments(db(), { orderId: id })).sum).toBe(80000);
  });

  it("cancels with a capped refund and never counts the order as revenue", async () => {
    const { a, base, fabricId } = await setup();
    const { id } = await db().transaction((tx) => createOrder(tx, a, base));
    await db().transaction((tx) => recordOrderPayment(tx, a, { orderId: id, amount: 20000, method: "CASH", externalReference: null, notes: null }));
    await expect(db().transaction((tx) => cancelOrder(tx, a, { orderId: id, reason: "Client changed mind", refund: { method: "CASH", amount: 20001 } }))).rejects.toThrow(/more than the customer paid/);
    await db().transaction((tx) => cancelOrder(tx, a, { orderId: id, reason: "Client changed mind", refund: { method: "CASH", amount: 15000 } }));
    const order = await getOrder(db(), id);
    expect(order).toMatchObject({ status: "CANCELLED", paid: 5000, outstanding: 0 });
    expect((await getFinancialSummary(db(), dayRange(today))).netRevenue).toBe(0);
    expect((await getProduct(db(), fabricId)).quantity).toBe(10);
    await expect(db().transaction((tx) => completeOrder(tx, a, id))).rejects.toThrow(/cannot be completed/);
  });

  it("edits open orders but never below the amount already paid", async () => {
    const { a, base } = await setup();
    const { id } = await db().transaction((tx) => createOrder(tx, a, base));
    await db().transaction((tx) => recordOrderPayment(tx, a, { orderId: id, amount: 50000, method: "CASH", externalReference: null, notes: null }));
    await expect(
      db().transaction((tx) => updateOrder(tx, a, id, { ...base, items: [{ kind: "SERVICE", productId: null, description: "Consultation", quantity: 1, unitPrice: 40000 }] })),
    ).rejects.toThrow(/less than what the customer/);
    await db().transaction((tx) => updateOrder(tx, a, id, { ...base, title: "Curtains + blinds", items: [...base.items, { kind: "SERVICE", productId: null, description: "Blinds", quantity: 1, unitPrice: 20000 }] }));
    expect((await getOrder(db(), id)).totalAmount).toBe(120000);
  });

  it("summarises customer spending and balances across sales and orders", async () => {
    const { a, base, customerId } = await setup();
    const { id } = await db().transaction((tx) => createOrder(tx, a, base));
    await db().transaction((tx) => recordOrderPayment(tx, a, { orderId: id, amount: 70000, method: "CASH", externalReference: null, notes: null }));
    await db().transaction((tx) => completeOrder(tx, a, id));
    const summary = await getCustomerSummary(db(), customerId);
    expect(summary).toMatchObject({ totalSpent: 100000, balance: 30000, ordersCount: 1 });
    expect((await listOrders(db(), { status: "COMPLETED", search: "curtain" })).total).toBe(1);
  });
});
