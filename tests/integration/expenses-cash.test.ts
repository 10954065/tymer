import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { dayRange, monthRange, todayBusinessDate } from "@/lib/dates";
import { closeDb, getDb } from "@/server/db/client";
import { closeCashSession, getCashMovements, getCashSession, openCashSession, suggestedOpening } from "@/server/services/cash";
import { correctExpense, createExpense, listExpenseCategories, listExpenses, updateExpenseDetails } from "@/server/services/expenses";
import { createProduct } from "@/server/services/products";
import { getFinancialSummary } from "@/server/services/reports/financials";
import { checkout } from "@/server/services/sales";
import { actor, createTestUser } from "../support/factories";
import { resetDatabase } from "../support/db";

const db = () => getDb();
const today = todayBusinessDate();

async function setup() {
  const user = await createTestUser("OWNER");
  const a = actor(user);
  const categories = await listExpenseCategories(db());
  const rent = categories.find((c) => c.name === "Rent")!;
  const base = { description: "November rent", amount: 150000, categoryId: rent.id, expenseDate: today, paymentMethod: "CASH" as const, orderId: null, attachmentKey: null, notes: null };
  return { a, base, categories };
}

describe("expenses", () => {
  beforeEach(resetDatabase);
  afterAll(closeDb);

  it("records operating expenses that reduce net operating profit", async () => {
    const { a, base } = await setup();
    await db().transaction((tx) => createExpense(tx, a, base));
    const summary = await getFinancialSummary(db(), monthRange(today));
    expect(summary).toMatchObject({ operatingExpenses: 150000, netOperatingProfit: -150000 });
  });

  it("corrects an expense with a reversal and replacement so totals stay exact and history is kept", async () => {
    const { a, base } = await setup();
    const { id } = await db().transaction((tx) => createExpense(tx, a, base));
    await db().transaction((tx) => correctExpense(tx, a, { expenseId: id, reason: "Typed 1500 instead of 1200", replacement: { ...base, amount: 120000 } }));
    const list = await listExpenses(db(), { range: dayRange(today) });
    expect(list.items).toHaveLength(3);
    expect(list.operating).toBe(120000);
    expect(list.items.find((e) => e.id === id)?.isCorrected).toBe(true);
    await expect(db().transaction((tx) => correctExpense(tx, a, { expenseId: id, reason: "again", replacement: null }))).rejects.toThrow(/already been corrected/);
  });

  it("edits only non-financial details", async () => {
    const { a, base, categories } = await setup();
    const { id } = await db().transaction((tx) => createExpense(tx, a, base));
    const other = categories.find((c) => c.name === "Miscellaneous")!;
    await db().transaction((tx) => updateExpenseDetails(tx, a, id, { description: "Shop rent", categoryId: other.id, notes: "Paid to landlord", attachmentKey: null }));
    const [row] = (await listExpenses(db(), { range: dayRange(today) })).items;
    expect(row).toMatchObject({ description: "Shop rent", categoryName: "Miscellaneous", amount: 150000 });
  });
});

describe("cash reconciliation", () => {
  beforeEach(resetDatabase);
  afterAll(closeDb);

  it("computes expected cash and records the difference with an explanation", async () => {
    const { a, base } = await setup();
    const product = await db().transaction((tx) =>
      createProduct(tx, a, { name: "Candle", sku: "C-1", barcode: null, categoryId: null, supplierId: null, description: null, costPrice: 1000, sellingPrice: 5000, reorderThreshold: 0, imageKey: null, initialStock: 10 }),
    );
    const session = await db().transaction((tx) => openCashSession(tx, a, { businessDate: today, openingBalance: 20000, notes: null }));
    await checkout(db(), a, { idempotencyKey: "cash-1", customerId: null, items: [{ productId: product.id, quantity: 3 }], payments: [{ method: "CASH", amount: 20000 }] }, { canOverrideDiscount: true });
    await checkout(db(), a, { idempotencyKey: "cash-2", customerId: null, items: [{ productId: product.id, quantity: 1 }], payments: [{ method: "MTN_MOMO", amount: 5000 }] }, { canOverrideDiscount: true });
    await db().transaction((tx) => createExpense(tx, a, { ...base, amount: 3000, description: "Transport" }));

    const movements = await getCashMovements(db(), today);
    expect(movements).toEqual({ cashReceived: 15000, cashRefunds: 0, cashExpenses: 3000, cashSupplierPayments: 0 });

    await expect(db().transaction((tx) => closeCashSession(tx, a, { sessionId: session.id, actualClosing: 31000, explanation: null }))).rejects.toThrow(/Explain/);
    const closed = await db().transaction((tx) => closeCashSession(tx, a, { sessionId: session.id, actualClosing: 31000, explanation: "GH₵1 coin missing" }));
    expect(closed).toEqual({ expected: 32000, difference: -1000 });
    expect(await getCashSession(db(), today)).toMatchObject({ status: "CLOSED", expectedClosing: 32000, actualClosing: 31000, difference: -1000 });
    await expect(db().transaction((tx) => closeCashSession(tx, a, { sessionId: session.id, actualClosing: 32000, explanation: null }))).rejects.toThrow(/already closed/);
    await expect(db().transaction((tx) => openCashSession(tx, a, { businessDate: today, openingBalance: 0, notes: null }))).rejects.toThrow(/already open/);
    expect(await suggestedOpening(db(), "2999-01-01")).toBe(31000);
  });
});
