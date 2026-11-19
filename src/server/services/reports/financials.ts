import { sql, type SQL } from "drizzle-orm";
import type { DateRange } from "@/lib/dates";
import type { DbClient } from "@/server/db/client";

/**
 * Financial calculations. Every figure is derived from ledger records with SQL aggregation (integer pesewas).
 *
 * Definitions (see DATABASE_DESIGN.md):
 * - Gross sales     = Σ(subtotal − discount) of non-voided sales created in the period (tax excluded)
 * - Returns         = Σ value of customer returns recorded in the period
 * - Order revenue   = Σ total_amount of orders COMPLETED in the period (deposits are not revenue)
 * - Net revenue     = gross sales − returns + order revenue
 * - COGS            = Σ sale cost snapshots − restocked cost of returns + order product costs
 *                     + direct order costs (expenses linked to orders completed in the period)
 * - Operating exp.  = Σ expenses not linked to an order (reversals net out) + direct costs of orders cancelled in the period
 * - Gross profit    = net revenue − COGS;  Net operating profit = gross profit − operating expenses
 * - Cash collected  = Σ signed customer payments received in the period
 */

export interface FinancialSummary {
  grossSales: number;
  discounts: number;
  salesCount: number;
  returns: number;
  orderRevenue: number;
  ordersCompleted: number;
  netRevenue: number;
  taxCollected: number;
  cogs: number;
  grossProfit: number;
  operatingExpenses: number;
  netOperatingProfit: number;
  cashCollected: number;
  /** Gross margin in basis points of net revenue (0 when there is no revenue). */
  grossMarginBps: number;
}

async function first<T extends Record<string, unknown>>(db: DbClient, query: SQL): Promise<T> {
  const result = await db.execute(query);
  return result.rows[0] as T;
}

export async function getFinancialSummary(db: DbClient, range: DateRange): Promise<FinancialSummary> {
  const { start, end, from, to } = range;
  const row = await first<{
    gross_sales: number;
    discounts: number;
    sales_count: number;
    sales_tax: number;
    sales_cost: number;
    returns_value: number;
    returns_tax: number;
    returns_restocked_cost: number;
    order_revenue: number;
    orders_completed: number;
    order_product_cost: number;
    order_direct_cost: number;
    cancelled_order_cost: number;
    opex: number;
    cash_collected: number;
  }>(
    db,
    sql`
    WITH s AS (
      SELECT coalesce(sum(subtotal - discount_total), 0)::bigint AS gross_sales,
             coalesce(sum(discount_total), 0)::bigint AS discounts,
             count(*)::int AS sales_count,
             coalesce(sum(tax_total), 0)::bigint AS sales_tax,
             coalesce(sum(cost_total), 0)::bigint AS sales_cost
      FROM sales WHERE status = 'COMPLETED' AND created_at >= ${start} AND created_at < ${end}
    ), r AS (
      SELECT coalesce(sum(sr.value_total), 0)::bigint AS returns_value,
             coalesce(sum(sr.tax_total), 0)::bigint AS returns_tax,
             coalesce(sum(sr.restocked_cost_total), 0)::bigint AS returns_restocked_cost
      FROM sale_returns sr JOIN sales sa ON sa.id = sr.sale_id AND sa.status = 'COMPLETED'
      WHERE sr.created_at >= ${start} AND sr.created_at < ${end}
    ), o AS (
      SELECT coalesce(sum(total_amount), 0)::bigint AS order_revenue,
             count(*)::int AS orders_completed,
             coalesce(sum(product_cost_total), 0)::bigint AS order_product_cost
      FROM orders WHERE status = 'COMPLETED' AND completed_at >= ${start} AND completed_at < ${end}
    ), od AS (
      SELECT coalesce(sum(e.amount), 0)::bigint AS order_direct_cost
      FROM expenses e JOIN orders ord ON ord.id = e.order_id
      WHERE ord.status = 'COMPLETED' AND ord.completed_at >= ${start} AND ord.completed_at < ${end}
    ), oc AS (
      SELECT coalesce(sum(e.amount), 0)::bigint AS cancelled_order_cost
      FROM expenses e JOIN orders ord ON ord.id = e.order_id
      WHERE ord.status = 'CANCELLED' AND ord.cancelled_at >= ${start} AND ord.cancelled_at < ${end}
    ), x AS (
      SELECT coalesce(sum(amount), 0)::bigint AS opex
      FROM expenses WHERE order_id IS NULL AND expense_date >= ${from}::date AND expense_date <= ${to}::date
    ), p AS (
      SELECT coalesce(sum(amount), 0)::bigint AS cash_collected
      FROM payments WHERE received_at >= ${start} AND received_at < ${end}
    )
    SELECT * FROM s, r, o, od, oc, x, p`,
  );

  const grossSales = row.gross_sales;
  const returns = row.returns_value;
  const netRevenue = grossSales - returns + row.order_revenue;
  const cogs = row.sales_cost - row.returns_restocked_cost + row.order_product_cost + row.order_direct_cost;
  const grossProfit = netRevenue - cogs;
  const operatingExpenses = row.opex + row.cancelled_order_cost;
  return {
    grossSales,
    discounts: row.discounts,
    salesCount: row.sales_count,
    returns,
    orderRevenue: row.order_revenue,
    ordersCompleted: row.orders_completed,
    netRevenue,
    taxCollected: row.sales_tax - row.returns_tax,
    cogs,
    grossProfit,
    operatingExpenses,
    netOperatingProfit: grossProfit - operatingExpenses,
    cashCollected: row.cash_collected,
    grossMarginBps: netRevenue > 0 ? Math.round((grossProfit * 10_000) / netRevenue) : 0,
  };
}

export interface Receivables {
  /** Unpaid balances on completed sales. */
  sales: number;
  salesCount: number;
  /** Unpaid balances on completed orders (owed now). */
  completedOrders: number;
  completedOrdersCount: number;
  /** Balances still to collect on open (not completed, not cancelled) orders. */
  openOrders: number;
  /** Money owed back to customers (overpayments). */
  customerCredit: number;
  total: number;
}

export async function getReceivables(db: DbClient): Promise<Receivables> {
  const row = await first<{
    sales: number;
    sales_count: number;
    sales_credit: number;
    completed_orders: number;
    completed_orders_count: number;
    open_orders: number;
    orders_credit: number;
  }>(
    db,
    sql`
    WITH sp AS (SELECT sale_id, sum(amount) AS amt FROM payments WHERE sale_id IS NOT NULL GROUP BY sale_id),
    sr AS (SELECT sale_id, sum(value_total + tax_total) AS amt FROM sale_returns GROUP BY sale_id),
    sb AS (
      SELECT s.total - coalesce(sr.amt, 0) - coalesce(sp.amt, 0) AS bal
      FROM sales s LEFT JOIN sp ON sp.sale_id = s.id LEFT JOIN sr ON sr.sale_id = s.id
      WHERE s.status = 'COMPLETED'
    ),
    op AS (SELECT order_id, sum(amount) AS amt FROM payments WHERE order_id IS NOT NULL GROUP BY order_id),
    ob AS (
      SELECT o.status, o.total_amount - coalesce(op.amt, 0) AS bal
      FROM orders o LEFT JOIN op ON op.order_id = o.id
      WHERE o.status <> 'CANCELLED'
    )
    SELECT
      (SELECT coalesce(sum(bal) FILTER (WHERE bal > 0), 0)::bigint FROM sb) AS sales,
      (SELECT count(*) FILTER (WHERE bal > 0)::int FROM sb) AS sales_count,
      (SELECT coalesce(-sum(bal) FILTER (WHERE bal < 0), 0)::bigint FROM sb) AS sales_credit,
      (SELECT coalesce(sum(bal) FILTER (WHERE bal > 0 AND status = 'COMPLETED'), 0)::bigint FROM ob) AS completed_orders,
      (SELECT count(*) FILTER (WHERE bal > 0 AND status = 'COMPLETED')::int FROM ob) AS completed_orders_count,
      (SELECT coalesce(sum(bal) FILTER (WHERE bal > 0 AND status <> 'COMPLETED'), 0)::bigint FROM ob) AS open_orders,
      (SELECT coalesce(-sum(bal) FILTER (WHERE bal < 0), 0)::bigint FROM ob) AS orders_credit`,
  );
  return {
    sales: row.sales,
    salesCount: row.sales_count,
    completedOrders: row.completed_orders,
    completedOrdersCount: row.completed_orders_count,
    openOrders: row.open_orders,
    customerCredit: row.sales_credit + row.orders_credit,
    total: row.sales + row.completed_orders,
  };
}

export interface InventoryValuation {
  value: number;
  retailValue: number;
  units: number;
  productsInStock: number;
}

/** Current quantity × weighted-average cost for every product with stock. */
export async function getInventoryValuation(db: DbClient): Promise<InventoryValuation> {
  const row = await first<{ value: number; retail_value: number; units: number; products_in_stock: number }>(
    db,
    sql`SELECT coalesce(sum(quantity::bigint * cost_price), 0)::bigint AS value,
               coalesce(sum(quantity::bigint * selling_price), 0)::bigint AS retail_value,
               coalesce(sum(quantity), 0)::bigint AS units,
               count(*)::int AS products_in_stock
        FROM products WHERE quantity > 0`,
  );
  return { value: row.value, retailValue: row.retail_value, units: row.units, productsInStock: row.products_in_stock };
}

export interface DailyPoint {
  date: string;
  revenue: number;
  grossProfit: number;
  cashCollected: number;
}

/** Day-by-day revenue, gross profit and cash for charts (Africa/Accra days). */
export async function getDailyTrend(db: DbClient, range: DateRange): Promise<DailyPoint[]> {
  const result = await db.execute<{ day: string; revenue: number; profit: number; cash: number }>(sql`
    WITH days AS (
      SELECT generate_series(${range.from}::date, ${range.to}::date, interval '1 day')::date AS day
    ),
    s AS (
      SELECT (created_at AT TIME ZONE 'Africa/Accra')::date AS day,
             sum(subtotal - discount_total)::bigint AS revenue, sum(subtotal - discount_total - cost_total)::bigint AS profit
      FROM sales WHERE status = 'COMPLETED' AND created_at >= ${range.start} AND created_at < ${range.end} GROUP BY 1
    ),
    r AS (
      SELECT (sr.created_at AT TIME ZONE 'Africa/Accra')::date AS day,
             sum(sr.value_total)::bigint AS revenue, sum(sr.value_total - sr.restocked_cost_total)::bigint AS profit
      FROM sale_returns sr JOIN sales sa ON sa.id = sr.sale_id AND sa.status = 'COMPLETED'
      WHERE sr.created_at >= ${range.start} AND sr.created_at < ${range.end} GROUP BY 1
    ),
    o AS (
      SELECT (o.completed_at AT TIME ZONE 'Africa/Accra')::date AS day, sum(o.total_amount)::bigint AS revenue,
             sum(o.total_amount - o.product_cost_total - coalesce(dc.amt, 0))::bigint AS profit
      FROM orders o LEFT JOIN (SELECT order_id, sum(amount) AS amt FROM expenses WHERE order_id IS NOT NULL GROUP BY order_id) dc
        ON dc.order_id = o.id
      WHERE o.status = 'COMPLETED' AND o.completed_at >= ${range.start} AND o.completed_at < ${range.end} GROUP BY 1
    ),
    p AS (
      SELECT (received_at AT TIME ZONE 'Africa/Accra')::date AS day, sum(amount)::bigint AS cash
      FROM payments WHERE received_at >= ${range.start} AND received_at < ${range.end} GROUP BY 1
    )
    SELECT to_char(days.day, 'YYYY-MM-DD') AS day,
           (coalesce(s.revenue, 0) - coalesce(r.revenue, 0) + coalesce(o.revenue, 0))::bigint AS revenue,
           (coalesce(s.profit, 0) - coalesce(r.profit, 0) + coalesce(o.profit, 0))::bigint AS profit,
           coalesce(p.cash, 0)::bigint AS cash
    FROM days
    LEFT JOIN s ON s.day = days.day LEFT JOIN r ON r.day = days.day
    LEFT JOIN o ON o.day = days.day LEFT JOIN p ON p.day = days.day
    ORDER BY days.day`);
  return result.rows.map((r) => ({ date: r.day, revenue: r.revenue, grossProfit: r.profit, cashCollected: r.cash }));
}

export interface PaymentMethodTotal {
  method: string;
  received: number;
  refunded: number;
  net: number;
  count: number;
}

export async function getPaymentMethodTotals(db: DbClient, range: DateRange): Promise<PaymentMethodTotal[]> {
  const result = await db.execute<{ method: string; received: number; refunded: number; net: number; count: number }>(sql`
    SELECT method,
           coalesce(sum(amount) FILTER (WHERE amount > 0), 0)::bigint AS received,
           coalesce(-sum(amount) FILTER (WHERE amount < 0), 0)::bigint AS refunded,
           coalesce(sum(amount), 0)::bigint AS net,
           count(*)::int AS count
    FROM payments WHERE received_at >= ${range.start} AND received_at < ${range.end}
    GROUP BY method ORDER BY net DESC`);
  return result.rows;
}
