import { and, asc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { AppError, notFound } from "@/lib/errors";
import type { DbClient, Tx } from "@/server/db/client";
import { suppliers } from "@/server/db/schema";
import { diffFields, recordAudit } from "./audit";
import type { Actor } from "./users";

export interface SupplierInput {
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
}

export async function listSupplierOptions(db: DbClient) {
  return db
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(eq(suppliers.isActive, true))
    .orderBy(asc(suppliers.name));
}

export interface SupplierRow {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  purchaseCount: number;
  totalPurchased: number;
  totalPaid: number;
  outstanding: number;
}

/** Suppliers with purchase totals and outstanding balances (received + draft purchases, excluding cancelled). */
export async function listSuppliers(db: DbClient, search?: string): Promise<SupplierRow[]> {
  const term = search?.trim();
  const result = await db.execute<{
    id: string;
    name: string;
    contact_person: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    notes: string | null;
    is_active: boolean;
    purchase_count: number;
    total_purchased: number;
    total_paid: number;
  }>(sql`
    WITH pt AS (
      SELECT supplier_id, count(*)::int AS purchase_count, coalesce(sum(total), 0)::bigint AS total_purchased
      FROM purchases WHERE status <> 'CANCELLED' GROUP BY supplier_id
    ), pp AS (
      SELECT sp.supplier_id, coalesce(sum(sp.amount), 0)::bigint AS total_paid
      FROM supplier_payments sp JOIN purchases p ON p.id = sp.purchase_id AND p.status <> 'CANCELLED'
      GROUP BY sp.supplier_id
    )
    SELECT s.id, s.name, s.contact_person, s.phone, s.email, s.address, s.notes, s.is_active,
           coalesce(pt.purchase_count, 0) AS purchase_count, coalesce(pt.total_purchased, 0)::bigint AS total_purchased,
           coalesce(pp.total_paid, 0)::bigint AS total_paid
    FROM suppliers s LEFT JOIN pt ON pt.supplier_id = s.id LEFT JOIN pp ON pp.supplier_id = s.id
    ${term ? sql`WHERE s.name ILIKE ${`%${term}%`} OR s.contact_person ILIKE ${`%${term}%`} OR s.phone ILIKE ${`%${term}%`}` : sql``}
    ORDER BY s.is_active DESC, s.name`);
  return result.rows.map((r) => ({
    id: r.id,
    name: r.name,
    contactPerson: r.contact_person,
    phone: r.phone,
    email: r.email,
    address: r.address,
    notes: r.notes,
    isActive: r.is_active,
    purchaseCount: r.purchase_count,
    totalPurchased: r.total_purchased,
    totalPaid: r.total_paid,
    outstanding: r.total_purchased - r.total_paid,
  }));
}

export async function getSupplier(db: DbClient, id: string): Promise<SupplierRow> {
  const rows = await listSuppliers(db);
  const row = rows.find((r) => r.id === id);
  if (!row) throw notFound("Supplier");
  return row;
}

async function assertUniqueName(db: DbClient, name: string, exceptId?: string) {
  const [row] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(sql`lower(${suppliers.name})`, name.toLowerCase()), exceptId ? ne(suppliers.id, exceptId) : undefined))
    .limit(1);
  if (row) throw new AppError("CONFLICT", `A supplier called "${name}" already exists`, { fieldErrors: { name: "Already exists" } });
}

export async function createSupplier(tx: Tx, actor: Actor, input: SupplierInput): Promise<{ id: string }> {
  await assertUniqueName(tx, input.name);
  const [created] = await tx.insert(suppliers).values(input).returning({ id: suppliers.id });
  await recordAudit(tx, { userId: actor.id, action: "supplier.created", entityType: "supplier", entityId: created.id, after: { name: input.name } });
  return created;
}

export async function updateSupplier(tx: Tx, actor: Actor, id: string, input: SupplierInput & { isActive: boolean }): Promise<void> {
  const [current] = await tx.select().from(suppliers).where(eq(suppliers.id, id)).limit(1);
  if (!current) throw notFound("Supplier");
  await assertUniqueName(tx, input.name, id);
  const changes = diffFields(current as unknown as Record<string, unknown>, { ...input });
  if (!changes) return;
  await tx.update(suppliers).set(input).where(eq(suppliers.id, id));
  await recordAudit(tx, { userId: actor.id, action: "supplier.updated", entityType: "supplier", entityId: id, ...changes });
}

export async function searchSuppliers(db: DbClient, term: string) {
  return db
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(or(ilike(suppliers.name, `%${term}%`), ilike(suppliers.phone, `%${term}%`)))
    .limit(20);
}
