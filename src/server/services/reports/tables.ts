import { sql } from "drizzle-orm";
import { formatDate, type DateRange } from "@/lib/dates";
import type { DbClient } from "@/server/db/client";
import { getDailyTrend, getFinancialSummary, getInventoryValuation, getPaymentMethodTotals } from "./financials";

export const REPORTS = {
  "profit-loss": "Profit and loss",
  sales: "Sales by period",
  products: "Product performance",
  inventory: "Inventory valuation",
  movements: "Stock movements",
  payments: "Payment methods",
  expenses: "Operating expenses",
  customers: "Customer balances",
  orders: "Order profitability",
} as const;

export type ReportKey = keyof typeof REPORTS;
export type ColumnType = "text" | "money" | "number" | "date" | "percent";

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
}

export type ReportRow = Record<string, string | number | null>;

export interface ReportTable {
  key: ReportKey;
  title: string;
  subtitle: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  totals?: ReportRow;
}

const col = (key: string, label: string, type: ColumnType = "text"): ReportColumn => ({ key, label, type });

function sumColumns(rows: ReportRow[], keys: string[], label: string): ReportRow {
  const totals: ReportRow = { [Object.keys(rows[0] ?? { label: "" })[0] ?? "label"]: label };
  for (const key of keys) totals[key] = rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
  return totals;
}

export async function buildReportTable(db: DbClient, key: ReportKey, range: DateRange, bucket: "day" | "week" | "month" = "day"): Promise<ReportTable> {
  const subtitle = `${formatDate(range.from)} – ${formatDate(range.to)}`;
  const base = { key, title: REPORTS[key], subtitle };
  switch (key) {
    case "profit-loss": {
      const s = await getFinancialSummary(db, range);
      const rows: ReportRow[] = [
        { line: "Gross sales (after discounts, excl. tax)", amount: s.grossSales },
        { line: "Less: customer returns", amount: -s.returns },
        { line: "Completed order revenue", amount: s.orderRevenue },
        { line: "Net revenue", amount: s.netRevenue },
        { line: "Less: cost of goods sold", amount: -s.cogs },
        { line: "Gross profit", amount: s.grossProfit },
        { line: "Less: operating expenses", amount: -s.operatingExpenses },
        { line: "Net operating profit", amount: s.netOperatingProfit },
        { line: "Memo: discounts given", amount: s.discounts },
        { line: "Memo: tax collected", amount: s.taxCollected },
        { line: "Memo: cash collected (all methods)", amount: s.cashCollected },
      ];
      return { ...base, columns: [col("line", "Line"), col("amount", "Amount", "money")], rows };
    }
    case "sales": {
      if (bucket === "day") {
        const trend = await getDailyTrend(db, range);
        const rows = trend.map((d) => ({ period: d.date, revenue: d.revenue, grossProfit: d.grossProfit, cash: d.cashCollected }));
        return { ...base, columns: [col("period", "Day", "date"), col("revenue", "Net revenue", "money"), col("grossProfit", "Gross profit", "money"), col("cash", "Cash collected", "money")], rows, totals: sumColumns(rows, ["revenue", "grossProfit", "cash"], "Total") };
      }
      const result = await db.execute<{ period: string; sales: number; revenue: number; profit: number; discounts: number }>(sql`
        SELECT to_char(date_trunc(${bucket}, created_at AT TIME ZONE 'Africa/Accra'), 'YYYY-MM-DD') AS period,
               count(*)::int AS sales, sum(subtotal - discount_total)::bigint AS revenue,
               sum(subtotal - discount_total - cost_total)::bigint AS profit, sum(discount_total)::bigint AS discounts
        FROM sales WHERE status = 'COMPLETED' AND created_at >= ${range.start} AND created_at < ${range.end}
        GROUP BY 1 ORDER BY 1`);
      const rows = result.rows.map((r) => ({ period: r.period, sales: r.sales, revenue: r.revenue, grossProfit: r.profit, discounts: r.discounts }));
      return { ...base, subtitle: `${subtitle} · POS sales by ${bucket}`, columns: [col("period", bucket === "week" ? "Week of" : "Month", "date"), col("sales", "Sales", "number"), col("revenue", "Revenue", "money"), col("grossProfit", "Gross profit", "money"), col("discounts", "Discounts", "money")], rows, totals: sumColumns(rows, ["sales", "revenue", "grossProfit", "discounts"], "Total") };
    }
    case "products": {
      const result = await db.execute<{ name: string; sku: string; units: number; revenue: number; cogs: number; stock: number; last_sold: string | null }>(sql`
        WITH sold AS (
          SELECT si.product_id, sum(si.quantity - si.returned_quantity)::int AS units,
                 sum(si.line_total - si.tax)::bigint AS gross, sum(si.quantity::bigint * si.unit_cost)::bigint AS cost, max(s.created_at) AS last_sold
          FROM sale_items si JOIN sales s ON s.id = si.sale_id AND s.status = 'COMPLETED'
          WHERE s.created_at >= ${range.start} AND s.created_at < ${range.end} GROUP BY si.product_id
        ), ret AS (
          SELECT si.product_id, sum(sri.value)::bigint AS value,
                 sum(CASE WHEN sri.restocked THEN sri.quantity::bigint * sri.unit_cost ELSE 0 END)::bigint AS cost
          FROM sale_return_items sri JOIN sale_returns sr ON sr.id = sri.return_id JOIN sale_items si ON si.id = sri.sale_item_id
          WHERE sr.created_at >= ${range.start} AND sr.created_at < ${range.end} GROUP BY si.product_id
        )
        SELECT p.name, p.sku, coalesce(sold.units, 0) AS units,
               (coalesce(sold.gross, 0) - coalesce(ret.value, 0))::bigint AS revenue,
               (coalesce(sold.cost, 0) - coalesce(ret.cost, 0))::bigint AS cogs, p.quantity AS stock,
               to_char(sold.last_sold AT TIME ZONE 'Africa/Accra', 'YYYY-MM-DD') AS last_sold
        FROM products p LEFT JOIN sold ON sold.product_id = p.id LEFT JOIN ret ON ret.product_id = p.id
        WHERE sold.product_id IS NOT NULL OR p.status = 'ACTIVE'
        ORDER BY coalesce(sold.units, 0) DESC, revenue DESC, p.name LIMIT 500`);
      const rows = result.rows.map((r) => ({
        product: r.name,
        sku: r.sku,
        units: r.units,
        revenue: r.revenue,
        cogs: r.cogs,
        grossProfit: r.revenue - r.cogs,
        margin: r.revenue > 0 ? Math.round(((r.revenue - r.cogs) * 10000) / r.revenue) : null,
        stock: r.stock,
        movement: r.units === 0 ? "Slow — no sales" : null,
      }));
      return { ...base, subtitle: `${subtitle} · best sellers first, slow movers (no sales) last`, columns: [col("product", "Product"), col("sku", "SKU"), col("units", "Units sold", "number"), col("revenue", "Revenue", "money"), col("cogs", "COGS", "money"), col("grossProfit", "Gross profit", "money"), col("margin", "Margin", "percent"), col("stock", "In stock", "number"), col("movement", "Note")], rows, totals: sumColumns(rows, ["units", "revenue", "cogs", "grossProfit"], "Total") };
    }
    case "inventory": {
      const valuation = await getInventoryValuation(db);
      const result = await db.execute<{ name: string; sku: string; category: string | null; quantity: number; cost_price: number; selling_price: number; status: string }>(sql`
        SELECT p.name, p.sku, c.name AS category, p.quantity, p.cost_price, p.selling_price, p.status
        FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.quantity <> 0 ORDER BY p.quantity::bigint * p.cost_price DESC`);
      const rows = result.rows.map((r) => ({ product: r.name, sku: r.sku, category: r.category, quantity: r.quantity, unitCost: r.cost_price, value: Math.max(r.quantity, 0) * r.cost_price, retailValue: Math.max(r.quantity, 0) * r.selling_price, status: r.status }));
      return { ...base, subtitle: `As at today · ${valuation.units} units at weighted-average cost`, columns: [col("product", "Product"), col("sku", "SKU"), col("category", "Category"), col("quantity", "Qty", "number"), col("unitCost", "Unit cost", "money"), col("value", "Value at cost", "money"), col("retailValue", "Retail value", "money"), col("status", "Status")], rows, totals: sumColumns(rows, ["quantity", "value", "retailValue"], "Total") };
    }
    case "movements": {
      const result = await db.execute<{ type: string; entries: number; units_in: number; units_out: number; cost_value: number }>(sql`
        SELECT type, count(*)::int AS entries,
               coalesce(sum(quantity_change) FILTER (WHERE quantity_change > 0), 0)::int AS units_in,
               coalesce(-sum(quantity_change) FILTER (WHERE quantity_change < 0), 0)::int AS units_out,
               coalesce(sum(abs(quantity_change)::bigint * coalesce(unit_cost, 0)), 0)::bigint AS cost_value
        FROM inventory_movements WHERE created_at >= ${range.start} AND created_at < ${range.end} GROUP BY type ORDER BY type`);
      const rows = result.rows.map((r) => ({ type: r.type, entries: r.entries, unitsIn: r.units_in, unitsOut: r.units_out, costValue: r.cost_value }));
      return { ...base, columns: [col("type", "Movement type"), col("entries", "Entries", "number"), col("unitsIn", "Units in", "number"), col("unitsOut", "Units out", "number"), col("costValue", "Value at cost", "money")], rows };
    }
    case "payments": {
      const totals = await getPaymentMethodTotals(db, range);
      const rows = totals.map((t) => ({ method: t.method, count: t.count, received: t.received, refunded: t.refunded, net: t.net }));
      return { ...base, columns: [col("method", "Method"), col("count", "Entries", "number"), col("received", "Received", "money"), col("refunded", "Refunded / reversed", "money"), col("net", "Net", "money")], rows, totals: sumColumns(rows, ["count", "received", "refunded", "net"], "Total") };
    }
    case "expenses": {
      const result = await db.execute<{ category: string; entries: number; amount: number }>(sql`
        SELECT c.name AS category, count(*)::int AS entries, sum(e.amount)::bigint AS amount
        FROM expenses e JOIN expense_categories c ON c.id = e.category_id
        WHERE e.order_id IS NULL AND e.expense_date >= ${range.from}::date AND e.expense_date <= ${range.to}::date
        GROUP BY c.name ORDER BY amount DESC`);
      const rows = result.rows.filter((r) => r.amount !== 0).map((r) => ({ category: r.category, entries: r.entries, amount: r.amount }));
      return { ...base, subtitle: `${subtitle} · excludes stock purchases and direct order costs`, columns: [col("category", "Category"), col("entries", "Entries", "number"), col("amount", "Amount", "money")], rows, totals: sumColumns(rows, ["entries", "amount"], "Total") };
    }
    case "customers": {
      const result = await db.execute<{ name: string; phone: string | null; sales_due: number; orders_due: number }>(sql`
        WITH sp AS (SELECT sale_id, sum(amount) AS amt FROM payments WHERE sale_id IS NOT NULL GROUP BY sale_id),
        sr AS (SELECT sale_id, sum(value_total + tax_total) AS amt FROM sale_returns GROUP BY sale_id),
        sb AS (SELECT s.customer_id, sum(s.total - coalesce(sr.amt, 0) - coalesce(sp.amt, 0)) AS due FROM sales s
               LEFT JOIN sp ON sp.sale_id = s.id LEFT JOIN sr ON sr.sale_id = s.id WHERE s.status = 'COMPLETED' AND s.customer_id IS NOT NULL GROUP BY s.customer_id),
        op AS (SELECT order_id, sum(amount) AS amt FROM payments WHERE order_id IS NOT NULL GROUP BY order_id),
        ob AS (SELECT o.customer_id, sum(o.total_amount - coalesce(op.amt, 0)) AS due FROM orders o LEFT JOIN op ON op.order_id = o.id WHERE o.status = 'COMPLETED' GROUP BY o.customer_id)
        SELECT c.full_name AS name, c.phone, coalesce(sb.due, 0)::bigint AS sales_due, coalesce(ob.due, 0)::bigint AS orders_due
        FROM customers c LEFT JOIN sb ON sb.customer_id = c.id LEFT JOIN ob ON ob.customer_id = c.id
        WHERE coalesce(sb.due, 0) + coalesce(ob.due, 0) <> 0 ORDER BY coalesce(sb.due, 0) + coalesce(ob.due, 0) DESC`);
      const rows = result.rows.map((r) => ({ customer: r.name, phone: r.phone, sales: r.sales_due, orders: r.orders_due, total: r.sales_due + r.orders_due }));
      return { ...base, subtitle: "As at today · positive = owed to the shop, negative = credit owed to the customer", columns: [col("customer", "Customer"), col("phone", "Phone"), col("sales", "Sales balance", "money"), col("orders", "Orders balance", "money"), col("total", "Total", "money")], rows, totals: sumColumns(rows, ["sales", "orders", "total"], "Total") };
    }
    case "orders": {
      const result = await db.execute<{ number: string; title: string; customer: string; completed: string; revenue: number; product_cost: number; direct: number }>(sql`
        SELECT o.order_number AS number, o.title, c.full_name AS customer, to_char(o.completed_at AT TIME ZONE 'Africa/Accra', 'YYYY-MM-DD') AS completed,
               o.total_amount AS revenue, o.product_cost_total AS product_cost,
               coalesce((SELECT sum(amount) FROM expenses e WHERE e.order_id = o.id), 0)::bigint AS direct
        FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.status = 'COMPLETED' AND o.completed_at >= ${range.start} AND o.completed_at < ${range.end} ORDER BY o.completed_at`);
      const rows = result.rows.map((r) => ({ order: r.number, title: r.title, customer: r.customer, completed: r.completed, revenue: r.revenue, productCost: r.product_cost, directCost: r.direct, profit: r.revenue - r.product_cost - r.direct }));
      return { ...base, columns: [col("order", "Order"), col("title", "Title"), col("customer", "Customer"), col("completed", "Completed", "date"), col("revenue", "Revenue", "money"), col("productCost", "Products used", "money"), col("directCost", "Direct costs", "money"), col("profit", "Profit", "money")], rows, totals: sumColumns(rows, ["revenue", "productCost", "directCost", "profit"], "Total") };
    }
  }
}
