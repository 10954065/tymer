import { and, asc, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { AppError, notFound } from "@/lib/errors";
import type { DbClient, Tx } from "@/server/db/client";
import { customers } from "@/server/db/schema";
import { diffFields, recordAudit } from "./audit";
import type { Actor } from "./users";

export interface CustomerInput {
  fullName: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
}

async function assertUniquePhone(db: DbClient, phone: string | null, exceptId?: string) {
  if (!phone) return;
  const [row] = await db
    .select({ id: customers.id, fullName: customers.fullName })
    .from(customers)
    .where(and(eq(customers.phone, phone), exceptId ? ne(customers.id, exceptId) : undefined))
    .limit(1);
  if (row) {
    throw new AppError("CONFLICT", `${row.fullName} already uses this phone number`, { fieldErrors: { phone: "Already used" } });
  }
}

export async function createCustomer(tx: Tx, actor: Actor, input: CustomerInput): Promise<{ id: string; fullName: string; phone: string | null }> {
  await assertUniquePhone(tx, input.phone);
  const [created] = await tx
    .insert(customers)
    .values(input)
    .returning({ id: customers.id, fullName: customers.fullName, phone: customers.phone });
  await recordAudit(tx, { userId: actor.id, action: "customer.created", entityType: "customer", entityId: created.id, after: { fullName: input.fullName } });
  return created;
}

export async function updateCustomer(tx: Tx, actor: Actor, id: string, input: CustomerInput & { isActive: boolean }): Promise<void> {
  const [current] = await tx.select().from(customers).where(eq(customers.id, id)).limit(1);
  if (!current) throw notFound("Customer");
  await assertUniquePhone(tx, input.phone, id);
  const changes = diffFields(current as unknown as Record<string, unknown>, { ...input });
  if (!changes) return;
  await tx.update(customers).set(input).where(eq(customers.id, id));
  await recordAudit(tx, { userId: actor.id, action: "customer.updated", entityType: "customer", entityId: id, ...changes });
}

export async function searchCustomers(db: DbClient, term: string, limit = 15) {
  const q = term.trim();
  return db
    .select({ id: customers.id, fullName: customers.fullName, phone: customers.phone })
    .from(customers)
    .where(
      and(
        eq(customers.isActive, true),
        q ? or(ilike(customers.fullName, `%${q}%`), ilike(customers.phone, `%${q.replace(/\s+/g, "%")}%`)) : undefined,
      ),
    )
    .orderBy(asc(customers.fullName))
    .limit(limit);
}

export interface CustomerListItem {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  createdAt: Date;
  salesCount: number;
  ordersCount: number;
  totalSpent: number;
  balance: number;
  lastPurchaseAt: string | null;
}

/** Customers with lifetime spend (sales net of returns + completed orders) and outstanding balances. */
export async function listCustomers(
  db: DbClient,
  options: { search?: string; page?: number; pageSize?: number; sort?: "name" | "spend" | "balance" } = {},
): Promise<{ items: CustomerListItem[]; total: number; page: number; pageSize: number }> {
  const pageSize = Math.min(Math.max(options.pageSize ?? 25, 5), 100);
  const page = Math.max(options.page ?? 1, 1);
  const q = options.search?.trim();
  const filter = q ? sql`WHERE c.full_name ILIKE ${`%${q}%`} OR c.phone ILIKE ${`%${q}%`}` : sql``;
  const order =
    options.sort === "spend" ? sql`total_spent DESC` : options.sort === "balance" ? sql`balance DESC` : sql`c.full_name ASC`;
  const result = await db.execute<{
    id: string;
    full_name: string;
    phone: string | null;
    email: string | null;
    created_at: Date;
    sales_count: number;
    orders_count: number;
    total_spent: number;
    balance: number;
    last_purchase_at: string | null;
  }>(sql`
    WITH ret AS (SELECT sale_id, sum(value_total + tax_total) AS amt FROM sale_returns GROUP BY sale_id),
    sp AS (SELECT sale_id, sum(amount) AS amt FROM payments WHERE sale_id IS NOT NULL GROUP BY sale_id),
    s AS (
      SELECT s.customer_id, count(*) AS cnt, sum(s.total - coalesce(ret.amt, 0)) AS spent,
             sum(s.total - coalesce(ret.amt, 0) - coalesce(sp.amt, 0)) AS bal, max(s.created_at) AS last_at
      FROM sales s LEFT JOIN ret ON ret.sale_id = s.id LEFT JOIN sp ON sp.sale_id = s.id
      WHERE s.status = 'COMPLETED' AND s.customer_id IS NOT NULL GROUP BY s.customer_id
    ),
    op AS (SELECT order_id, sum(amount) AS amt FROM payments WHERE order_id IS NOT NULL GROUP BY order_id),
    o AS (
      SELECT o.customer_id, count(*) AS cnt,
             sum(o.total_amount) FILTER (WHERE o.status = 'COMPLETED') AS spent,
             sum(o.total_amount - coalesce(op.amt, 0)) FILTER (WHERE o.status = 'COMPLETED') AS bal,
             max(o.completed_at) AS last_at
      FROM orders o LEFT JOIN op ON op.order_id = o.id WHERE o.status <> 'CANCELLED' GROUP BY o.customer_id
    )
    SELECT c.id, c.full_name, c.phone, c.email, c.created_at,
           coalesce(s.cnt, 0)::int AS sales_count, coalesce(o.cnt, 0)::int AS orders_count,
           (coalesce(s.spent, 0) + coalesce(o.spent, 0))::bigint AS total_spent,
           (coalesce(s.bal, 0) + coalesce(o.bal, 0))::bigint AS balance,
           to_char(greatest(s.last_at, o.last_at), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_purchase_at,
           count(*) OVER ()::int AS total_count
    FROM customers c LEFT JOIN s ON s.customer_id = c.id LEFT JOIN o ON o.customer_id = c.id
    ${filter}
    ORDER BY ${order}
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`);
  const rows = result.rows as unknown as (Record<string, unknown> & { total_count: number })[];
  return {
    items: result.rows.map((r) => ({
      id: r.id,
      fullName: r.full_name,
      phone: r.phone,
      email: r.email,
      createdAt: r.created_at,
      salesCount: r.sales_count,
      ordersCount: r.orders_count,
      totalSpent: r.total_spent,
      balance: r.balance,
      lastPurchaseAt: r.last_purchase_at,
    })),
    total: rows[0]?.total_count ?? (page === 1 ? 0 : (page - 1) * pageSize),
    page,
    pageSize,
  };
}

export async function getCustomer(db: DbClient, id: string) {
  const [row] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  if (!row) throw notFound("Customer");
  return row;
}

/** Lifetime spend and outstanding balance for one customer. */
export async function getCustomerSummary(db: DbClient, id: string) {
  const result = await db.execute<{ total_spent: number; balance: number; sales_count: number; orders_count: number }>(sql`
    SELECT
      (SELECT coalesce(sum(s.total - coalesce((SELECT sum(value_total + tax_total) FROM sale_returns r WHERE r.sale_id = s.id), 0)), 0)
         FROM sales s WHERE s.customer_id = ${id} AND s.status = 'COMPLETED')
      + (SELECT coalesce(sum(total_amount), 0) FROM orders WHERE customer_id = ${id} AND status = 'COMPLETED') AS total_spent,
      (SELECT coalesce(sum(s.total - coalesce((SELECT sum(value_total + tax_total) FROM sale_returns r WHERE r.sale_id = s.id), 0)
         - coalesce((SELECT sum(amount) FROM payments p WHERE p.sale_id = s.id), 0)), 0)
         FROM sales s WHERE s.customer_id = ${id} AND s.status = 'COMPLETED')
      + (SELECT coalesce(sum(o.total_amount - coalesce((SELECT sum(amount) FROM payments p WHERE p.order_id = o.id), 0)), 0)
         FROM orders o WHERE o.customer_id = ${id} AND o.status = 'COMPLETED') AS balance,
      (SELECT count(*)::int FROM sales WHERE customer_id = ${id} AND status = 'COMPLETED') AS sales_count,
      (SELECT count(*)::int FROM orders WHERE customer_id = ${id} AND status <> 'CANCELLED') AS orders_count`);
  const r = result.rows[0];
  return { totalSpent: Number(r.total_spent), balance: Number(r.balance), salesCount: r.sales_count, ordersCount: r.orders_count };
}

export async function recentCustomers(db: DbClient, limit = 8) {
  return db
    .select({ id: customers.id, fullName: customers.fullName, phone: customers.phone })
    .from(customers)
    .where(eq(customers.isActive, true))
    .orderBy(desc(customers.updatedAt))
    .limit(limit);
}
