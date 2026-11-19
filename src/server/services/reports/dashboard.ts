import { and, desc, eq, lte, sql } from "drizzle-orm";
import { addBusinessDays, dayRange, monthRange, rangeFromDates, todayBusinessDate } from "@/lib/dates";
import type { DbClient } from "@/server/db/client";
import { customers, products, sales } from "@/server/db/schema";
import {
  getDailyTrend,
  getFinancialSummary,
  getInventoryValuation,
  getReceivables,
  type DailyPoint,
  type FinancialSummary,
  type InventoryValuation,
  type Receivables,
} from "./financials";

export interface LowStockItem {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  reorderThreshold: number;
}

export interface RecentSale {
  id: string;
  saleNumber: string;
  total: number;
  status: "COMPLETED" | "VOIDED";
  createdAt: string;
  customerName: string | null;
}

export interface DashboardData {
  businessDate: string;
  today: FinancialSummary;
  month: FinancialSummary;
  receivables: Receivables;
  inventory: InventoryValuation;
  trend: DailyPoint[];
  lowStock: LowStockItem[];
  lowStockCount: number;
  recentSales: RecentSale[];
}

export async function getLowStock(db: DbClient, limit = 8): Promise<{ items: LowStockItem[]; count: number }> {
  const condition = and(eq(products.status, "ACTIVE"), lte(products.quantity, products.reorderThreshold));
  const [items, [counted]] = await Promise.all([
    db
      .select({
        id: products.id,
        name: products.name,
        sku: products.sku,
        quantity: products.quantity,
        reorderThreshold: products.reorderThreshold,
      })
      .from(products)
      .where(condition)
      .orderBy(products.quantity, products.name)
      .limit(limit),
    db.select({ n: sql<number>`count(*)::int` }).from(products).where(condition),
  ]);
  return { items, count: counted?.n ?? 0 };
}

export async function getRecentSales(db: DbClient, limit = 6): Promise<RecentSale[]> {
  const rows = await db
    .select({
      id: sales.id,
      saleNumber: sales.saleNumber,
      total: sales.total,
      status: sales.status,
      createdAt: sales.createdAt,
      customerName: customers.fullName,
    })
    .from(sales)
    .leftJoin(customers, eq(customers.id, sales.customerId))
    .orderBy(desc(sales.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

/** All dashboard figures in one call; queries run in parallel on the pooled connection. */
export async function getDashboardData(db: DbClient, businessDate = todayBusinessDate()): Promise<DashboardData> {
  const trendRange = rangeFromDates(addBusinessDays(businessDate, -29), businessDate);
  const [today, month, receivables, inventory, trend, lowStock, recentSales] = await Promise.all([
    getFinancialSummary(db, dayRange(businessDate)),
    getFinancialSummary(db, monthRange(businessDate)),
    getReceivables(db),
    getInventoryValuation(db),
    getDailyTrend(db, trendRange),
    getLowStock(db),
    getRecentSales(db),
  ]);
  return {
    businessDate,
    today,
    month,
    receivables,
    inventory,
    trend,
    lowStock: lowStock.items,
    lowStockCount: lowStock.count,
    recentSales,
  };
}
