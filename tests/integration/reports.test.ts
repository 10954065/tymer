import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { monthRange, todayBusinessDate } from "@/lib/dates";
import { closeDb, getDb } from "@/server/db/client";
import { createProduct } from "@/server/services/products";
import { toCsv, toXlsx } from "@/server/services/reports/export";
import { getFinancialSummary } from "@/server/services/reports/financials";
import { buildReportTable, REPORTS, type ReportKey } from "@/server/services/reports/tables";
import { createReturn } from "@/server/services/returns";
import { checkout, getSale } from "@/server/services/sales";
import { actor, createTestUser } from "../support/factories";
import { resetDatabase } from "../support/db";

const db = () => getDb();
const range = monthRange(todayBusinessDate());

describe("report tables and exports", () => {
  beforeAll(async () => {
    await resetDatabase();
    const a = actor(await createTestUser("OWNER"));
    const base = { barcode: null, categoryId: null, supplierId: null, description: null, reorderThreshold: 1, imageKey: null };
    const mirror = await db().transaction((tx) => createProduct(tx, a, { ...base, name: "=HYPERLINK(\"x\")", sku: "M-1", costPrice: 10000, sellingPrice: 25000, initialStock: 5 }));
    await db().transaction((tx) => createProduct(tx, a, { ...base, name: "Slow lamp", sku: "L-1", costPrice: 5000, sellingPrice: 9000, initialStock: 3 }));
    const { saleId } = await checkout(db(), a, { idempotencyKey: "r-1", customerId: null, items: [{ productId: mirror.id, quantity: 3 }], payments: [{ method: "CASH", amount: 75000 }] }, { canOverrideDiscount: true });
    const itemId = (await getSale(db(), saleId)).items[0].id;
    await db().transaction((tx) => createReturn(tx, a, { saleId, idempotencyKey: "r-ret", reason: "Scratched", items: [{ saleItemId: itemId, quantity: 1, restock: true }], refund: { method: "CASH", amount: 25000 } }));
  });
  afterAll(closeDb);

  it("produces a profit and loss statement consistent with the financial summary", async () => {
    const table = await buildReportTable(db(), "profit-loss", range);
    const summary = await getFinancialSummary(db(), range);
    const line = (label: string) => table.rows.find((r) => r.line === label)?.amount;
    expect(line("Net revenue")).toBe(summary.netRevenue);
    expect(line("Gross profit")).toBe(summary.grossProfit);
    expect(line("Net operating profit")).toBe(summary.netOperatingProfit);
    expect(summary).toMatchObject({ netRevenue: 50000, cogs: 20000, grossProfit: 30000 });
  });

  it("ranks best sellers, nets returns and flags slow movers", async () => {
    const table = await buildReportTable(db(), "products", range);
    expect(table.rows[0]).toMatchObject({ sku: "M-1", units: 2, revenue: 50000, cogs: 20000, grossProfit: 30000, margin: 6000 });
    expect(table.rows.find((r) => r.sku === "L-1")).toMatchObject({ units: 0, movement: "Slow — no sales" });
  });

  it("builds every report without errors", async () => {
    for (const key of Object.keys(REPORTS) as ReportKey[]) {
      const table = await buildReportTable(db(), key, range, key === "sales" ? "month" : "day");
      expect(table.columns.length).toBeGreaterThan(1);
    }
    const inventory = await buildReportTable(db(), "inventory", range);
    expect(inventory.totals).toMatchObject({ quantity: 6, value: 45000 });
  });

  it("exports CSV safely (formula injection neutralised) and Excel workbooks", async () => {
    const table = await buildReportTable(db(), "products", range);
    const csv = toCsv(table);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"500.00"');
    const xlsx = await toXlsx(table, "SMARTLIVING BUYNFRY VENTURES");
    expect(xlsx.subarray(0, 2).toString()).toBe("PK");
  });
});
