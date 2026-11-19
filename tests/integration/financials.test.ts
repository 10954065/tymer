import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dayRange, monthRange, todayBusinessDate } from "@/lib/dates";
import { closeDb, getDb } from "@/server/db/client";
import {
  customers,
  expenseCategories,
  expenses,
  orders,
  payments,
  products,
  saleReturns,
  sales,
} from "@/server/db/schema";
import {
  getDailyTrend,
  getFinancialSummary,
  getInventoryValuation,
  getPaymentMethodTotals,
  getReceivables,
} from "@/server/services/reports/financials";
import { getDashboardData } from "@/server/services/reports/dashboard";
import { createTestUser } from "../support/factories";
import { resetDatabase } from "../support/db";

const db = () => getDb();
const today = todayBusinessDate();

/**
 * Hand-calculated scenario (all amounts in pesewas):
 *  Sale 1: 2 × 50.00 − 10.00 discount = 90.00, cost 60.00, paid 90.00 cash
 *  Sale 2: 50.00, cost 30.00, paid 20.00 MoMo (30.00 outstanding)
 *  Sale 3: 40.00, VOIDED (ignored everywhere)
 *  Return on sale 1: 45.00 value, 30.00 cost restocked, refund 45.00 cash
 *  Order A: COMPLETED today, agreed 200.00, product cost 20.00, direct materials expense 50.00,
 *           paid 100.00 + 50.00 (50.00 outstanding)
 *  Order B: IN_PROGRESS, agreed 80.00, deposit 30.00 (deposit is cash, not revenue)
 *  Expenses: rent 100.00; mistaken 20.00 + its reversal −20.00; last month's 70.00 (outside the period)
 *
 * Expected for today:
 *  gross sales 140.00, returns 45.00, order revenue 200.00 → net revenue 295.00
 *  COGS = 90.00 − 30.00 + 20.00 + 50.00 = 130.00 → gross profit 165.00
 *  operating expenses 100.00 → net operating profit 65.00
 *  cash collected = 90 + 20 − 45 + 100 + 50 + 30 = 245.00
 *  receivables = 30.00 (sale 2) + 50.00 (order A) = 80.00; open orders to collect 50.00
 */
describe("financial calculations", () => {
  let userId: string;

  beforeAll(async () => {
    await resetDatabase();
    const user = await createTestUser("OWNER");
    userId = user.id;
    const [customer] = await db().insert(customers).values({ fullName: "Akosua Boateng" }).returning();
    await db().insert(products).values([
      { name: "Ceramic vase", sku: "VAS-01", costPrice: 3000, sellingPrice: 5000, quantity: 10 },
      { name: "Wall clock", sku: "CLK-01", costPrice: 8000, sellingPrice: 12000, quantity: 0, status: "OUT_OF_STOCK" },
    ]);

    const [s1, s2] = await db()
      .insert(sales)
      .values([
        { idempotencyKey: "s1", subtotal: 10000, discountTotal: 1000, total: 9000, costTotal: 6000, createdBy: userId },
        { idempotencyKey: "s2", subtotal: 5000, total: 5000, costTotal: 3000, createdBy: userId, customerId: customer.id },
        {
          idempotencyKey: "s3",
          subtotal: 4000,
          total: 4000,
          costTotal: 2000,
          createdBy: userId,
          status: "VOIDED",
          voidedAt: new Date(),
          voidReason: "Keyed twice",
        },
      ])
      .returning();
    const [ret] = await db()
      .insert(saleReturns)
      .values({ saleId: s1.id, idempotencyKey: "r1", reason: "Chipped", valueTotal: 4500, restockedCostTotal: 3000, createdBy: userId })
      .returning();

    const [orderA, orderB] = await db()
      .insert(orders)
      .values([
        {
          customerId: customer.id,
          title: "Living room styling",
          status: "COMPLETED",
          totalAmount: 20000,
          productCostTotal: 2000,
          completedAt: new Date(),
          createdBy: userId,
        },
        { customerId: customer.id, title: "Curtains", status: "IN_PROGRESS", totalAmount: 8000, createdBy: userId },
      ])
      .returning();

    await db().insert(payments).values([
      { kind: "RECEIPT", method: "CASH", amount: 9000, saleId: s1.id, receivedBy: userId },
      { kind: "RECEIPT", method: "MTN_MOMO", amount: 2000, saleId: s2.id, receivedBy: userId },
      { kind: "REFUND", method: "CASH", amount: -4500, saleId: s1.id, returnId: ret.id, receivedBy: userId },
      { kind: "RECEIPT", method: "BANK_TRANSFER", amount: 10000, orderId: orderA.id, receivedBy: userId },
      { kind: "RECEIPT", method: "CASH", amount: 5000, orderId: orderA.id, receivedBy: userId },
      { kind: "RECEIPT", method: "MTN_MOMO", amount: 3000, orderId: orderB.id, receivedBy: userId },
    ]);

    const [category] = await db().select().from(expenseCategories).limit(1);
    const lastMonth = monthRange(today).start;
    lastMonth.setUTCDate(0);
    const [mistake] = await db()
      .insert(expenses)
      .values([
        { description: "Rent", amount: 10000, categoryId: category.id, expenseDate: today, paymentMethod: "CASH", createdBy: userId },
        { description: "Mistake", amount: 2000, categoryId: category.id, expenseDate: today, paymentMethod: "CASH", createdBy: userId },
      ])
      .returning();
    await db().insert(expenses).values([
      {
        description: "Reversal",
        amount: -2000,
        categoryId: category.id,
        expenseDate: today,
        paymentMethod: "CASH",
        reversalOfId: mistake.id,
        createdBy: userId,
      },
      {
        description: "Materials for order A",
        amount: 5000,
        categoryId: category.id,
        expenseDate: today,
        paymentMethod: "CASH",
        orderId: orderA.id,
        createdBy: userId,
      },
      {
        description: "Old electricity bill",
        amount: 7000,
        categoryId: category.id,
        expenseDate: lastMonth.toISOString().slice(0, 10),
        paymentMethod: "CASH",
        createdBy: userId,
      },
    ]);
  });

  afterAll(closeDb);

  it("computes revenue, COGS, profit and expenses for the day", async () => {
    const summary = await getFinancialSummary(db(), dayRange(today));
    expect(summary).toMatchObject({
      grossSales: 14000,
      discounts: 1000,
      salesCount: 2,
      returns: 4500,
      orderRevenue: 20000,
      ordersCompleted: 1,
      netRevenue: 29500,
      cogs: 13000,
      grossProfit: 16500,
      operatingExpenses: 10000,
      netOperatingProfit: 6500,
      cashCollected: 24500,
    });
    expect(summary.grossMarginBps).toBe(5593);
  });

  it("distinguishes cash collected from revenue (deposits are not revenue)", async () => {
    const summary = await getFinancialSummary(db(), dayRange(today));
    expect(summary.cashCollected).not.toBe(summary.netRevenue);
  });

  it("computes outstanding receivables per sale and order", async () => {
    const receivables = await getReceivables(db());
    expect(receivables).toMatchObject({
      sales: 3000,
      salesCount: 1,
      completedOrders: 5000,
      completedOrdersCount: 1,
      openOrders: 5000,
      customerCredit: 0,
      total: 8000,
    });
  });

  it("values inventory at quantity × weighted-average cost", async () => {
    expect(await getInventoryValuation(db())).toEqual({ value: 30000, retailValue: 50000, units: 10, productsInStock: 1 });
  });

  it("splits payments by method with refunds", async () => {
    const totals = await getPaymentMethodTotals(db(), dayRange(today));
    const cash = totals.find((t) => t.method === "CASH");
    expect(cash).toMatchObject({ received: 14000, refunded: 4500, net: 9500 });
    expect(totals.reduce((sum, t) => sum + t.net, 0)).toBe(24500);
  });

  it("builds a daily trend that matches the summary", async () => {
    const trend = await getDailyTrend(db(), dayRange(today));
    expect(trend).toHaveLength(1);
    expect(trend[0]).toMatchObject({ date: today, revenue: 29500, grossProfit: 16500, cashCollected: 24500 });
  });

  it("assembles the dashboard from the same figures", async () => {
    const dashboard = await getDashboardData(db(), today);
    expect(dashboard.today.netRevenue).toBe(29500);
    expect(dashboard.receivables.total).toBe(8000);
    expect(dashboard.trend).toHaveLength(30);
    expect(dashboard.lowStockCount).toBe(0);
    expect(dashboard.recentSales).toHaveLength(3);
  });
});
