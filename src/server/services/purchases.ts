import { and, desc, eq, sql } from "drizzle-orm";
import { AppError, notFound } from "@/lib/errors";
import type { PaymentMethod } from "@/lib/validation/common";
import type { DbClient, Tx } from "@/server/db/client";
import { products, purchaseItems, purchases, supplierPayments, suppliers, users } from "@/server/db/schema";
import { recordAudit } from "./audit";
import { receiveStock } from "./inventory";
import type { Actor } from "./users";

export type PurchaseStatus = (typeof purchases.$inferSelect)["status"];

export interface PurchaseItemInput {
  productId: string;
  quantity: number;
  unitCost: number;
}

export interface PurchaseInput {
  supplierId: string;
  purchaseDate: string;
  supplierReference: string | null;
  notes: string | null;
  items: PurchaseItemInput[];
}

function validateItems(items: PurchaseItemInput[]): void {
  if (items.length === 0) throw new AppError("VALIDATION", "Add at least one product to the purchase");
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.productId)) throw new AppError("VALIDATION", "Each product can appear only once; adjust its quantity instead");
    seen.add(item.productId);
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new AppError("VALIDATION", "Quantities must be whole numbers above zero");
    if (!Number.isInteger(item.unitCost) || item.unitCost < 0) throw new AppError("VALIDATION", "Unit costs cannot be negative");
  }
}

async function insertItems(tx: Tx, purchaseId: string, items: PurchaseItemInput[]): Promise<number> {
  await tx.insert(purchaseItems).values(
    items.map((item) => ({
      purchaseId,
      productId: item.productId,
      quantity: item.quantity,
      unitCost: item.unitCost,
      lineTotal: item.quantity * item.unitCost,
    })),
  );
  return items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
}

export async function createPurchase(tx: Tx, actor: Actor, input: PurchaseInput): Promise<{ id: string; purchaseNumber: string }> {
  validateItems(input.items);
  const [supplier] = await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, input.supplierId));
  if (!supplier) throw notFound("Supplier");
  const [created] = await tx
    .insert(purchases)
    .values({
      supplierId: input.supplierId,
      purchaseDate: input.purchaseDate,
      supplierReference: input.supplierReference,
      notes: input.notes,
      createdBy: actor.id,
    })
    .returning({ id: purchases.id, purchaseNumber: purchases.purchaseNumber });
  const total = await insertItems(tx, created.id, input.items);
  await tx.update(purchases).set({ total }).where(eq(purchases.id, created.id));
  await recordAudit(tx, {
    userId: actor.id,
    action: "purchase.created",
    entityType: "purchase",
    entityId: created.id,
    reference: created.purchaseNumber,
    after: { supplierId: input.supplierId, total, items: input.items.length },
  });
  return created;
}

async function lockPurchase(tx: Tx, id: string) {
  const [purchase] = await tx.select().from(purchases).where(eq(purchases.id, id)).for("update");
  if (!purchase) throw notFound("Purchase");
  return purchase;
}

/** Replaces the items of a draft purchase. Received purchases are final. */
export async function updateDraftPurchase(tx: Tx, actor: Actor, id: string, input: PurchaseInput): Promise<void> {
  validateItems(input.items);
  const purchase = await lockPurchase(tx, id);
  if (purchase.status !== "DRAFT") throw new AppError("CONFLICT", "Only draft purchases can be edited");
  await tx.delete(purchaseItems).where(eq(purchaseItems.purchaseId, id));
  const total = await insertItems(tx, id, input.items);
  await tx
    .update(purchases)
    .set({ supplierId: input.supplierId, purchaseDate: input.purchaseDate, supplierReference: input.supplierReference, notes: input.notes, total })
    .where(eq(purchases.id, id));
  await recordAudit(tx, {
    userId: actor.id,
    action: "purchase.updated",
    entityType: "purchase",
    entityId: id,
    reference: purchase.purchaseNumber,
    before: { total: purchase.total },
    after: { total },
  });
}

/**
 * Confirms delivery: stock increases for every line at its unit cost (weighted-average cost updated) and the
 * purchase becomes final. Out-of-stock products are reactivated automatically.
 */
export async function receivePurchase(tx: Tx, actor: Actor, id: string): Promise<void> {
  const purchase = await lockPurchase(tx, id);
  if (purchase.status !== "DRAFT") throw new AppError("CONFLICT", `This purchase is already ${purchase.status.toLowerCase()}`);
  const items = await tx.select().from(purchaseItems).where(eq(purchaseItems.purchaseId, id)).orderBy(purchaseItems.productId);
  if (items.length === 0) throw new AppError("VALIDATION", "The purchase has no items");
  for (const item of items) {
    await receiveStock(tx, {
      productId: item.productId,
      quantity: item.quantity,
      unitCost: item.unitCost,
      userId: actor.id,
      referenceType: "purchase",
      referenceId: id,
      reason: `Purchase ${purchase.purchaseNumber}`,
    });
  }
  await tx.update(purchases).set({ status: "RECEIVED", receivedAt: new Date(), receivedBy: actor.id }).where(eq(purchases.id, id));
  await recordAudit(tx, {
    userId: actor.id,
    action: "purchase.received",
    entityType: "purchase",
    entityId: id,
    reference: purchase.purchaseNumber,
    after: { status: "RECEIVED", total: purchase.total },
  });
}

export async function getSupplierPaid(db: DbClient, purchaseId: string): Promise<number> {
  const [row] = await db
    .select({ paid: sql<number>`coalesce(sum(${supplierPayments.amount}), 0)::bigint` })
    .from(supplierPayments)
    .where(eq(supplierPayments.purchaseId, purchaseId));
  return row?.paid ?? 0;
}

export async function cancelPurchase(tx: Tx, actor: Actor, id: string, reason: string): Promise<void> {
  const purchase = await lockPurchase(tx, id);
  if (purchase.status !== "DRAFT") throw new AppError("CONFLICT", "Only draft purchases can be cancelled; received stock is final");
  if ((await getSupplierPaid(tx, id)) !== 0) {
    throw new AppError("CONFLICT", "Reverse the payments made on this purchase before cancelling it");
  }
  await tx.update(purchases).set({ status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason }).where(eq(purchases.id, id));
  await recordAudit(tx, { userId: actor.id, action: "purchase.cancelled", entityType: "purchase", entityId: id, reference: purchase.purchaseNumber, reason });
}

export async function recordSupplierPayment(
  tx: Tx,
  actor: Actor,
  input: { purchaseId: string; amount: number; method: PaymentMethod; externalReference: string | null; notes: string | null },
): Promise<{ id: string; paymentNumber: string }> {
  const purchase = await lockPurchase(tx, input.purchaseId);
  if (purchase.status === "CANCELLED") throw new AppError("CONFLICT", "Cannot pay a cancelled purchase");
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new AppError("VALIDATION", "Payment must be greater than zero");
  const outstanding = purchase.total - (await getSupplierPaid(tx, purchase.id));
  if (input.amount > outstanding) {
    throw new AppError("VALIDATION", "Payment is more than the outstanding balance", { fieldErrors: { amount: "Exceeds balance" } });
  }
  const [payment] = await tx
    .insert(supplierPayments)
    .values({
      purchaseId: purchase.id,
      supplierId: purchase.supplierId,
      kind: "PAYMENT",
      method: input.method,
      amount: input.amount,
      externalReference: input.externalReference,
      notes: input.notes,
      paidBy: actor.id,
    })
    .returning({ id: supplierPayments.id, paymentNumber: supplierPayments.paymentNumber });
  await recordAudit(tx, {
    userId: actor.id,
    action: "supplier_payment.recorded",
    entityType: "purchase",
    entityId: purchase.id,
    reference: payment.paymentNumber,
    after: { amount: input.amount, method: input.method },
  });
  return payment;
}

/** Cancels a mistaken supplier payment with an equal negative entry; the original row is never changed. */
export async function reverseSupplierPayment(tx: Tx, actor: Actor, input: { paymentId: string; reason: string }): Promise<void> {
  const [original] = await tx.select().from(supplierPayments).where(eq(supplierPayments.id, input.paymentId)).for("update");
  if (!original) throw notFound("Payment");
  if (original.kind !== "PAYMENT") throw new AppError("VALIDATION", "Only payments can be reversed");
  const [existing] = await tx.select({ id: supplierPayments.id }).from(supplierPayments).where(eq(supplierPayments.reversesPaymentId, original.id));
  if (existing) throw new AppError("CONFLICT", "This payment has already been reversed");
  await tx.insert(supplierPayments).values({
    purchaseId: original.purchaseId,
    supplierId: original.supplierId,
    kind: "REVERSAL",
    method: original.method,
    amount: -original.amount,
    reversesPaymentId: original.id,
    notes: input.reason,
    paidBy: actor.id,
  });
  await recordAudit(tx, {
    userId: actor.id,
    action: "supplier_payment.reversed",
    entityType: "purchase",
    entityId: original.purchaseId,
    reference: original.paymentNumber,
    reason: input.reason,
    before: { amount: original.amount },
  });
}

export interface PurchaseListItem {
  id: string;
  purchaseNumber: string;
  supplierId: string;
  supplierName: string;
  status: PurchaseStatus;
  purchaseDate: string;
  supplierReference: string | null;
  total: number;
  paid: number;
  outstanding: number;
}

export async function listPurchases(
  db: DbClient,
  options: { status?: PurchaseStatus; supplierId?: string; page?: number; pageSize?: number } = {},
): Promise<{ items: PurchaseListItem[]; total: number; page: number; pageSize: number }> {
  const pageSize = Math.min(Math.max(options.pageSize ?? 25, 5), 100);
  const page = Math.max(options.page ?? 1, 1);
  const where = and(
    options.status ? eq(purchases.status, options.status) : undefined,
    options.supplierId ? eq(purchases.supplierId, options.supplierId) : undefined,
  );
  const paid = sql<number>`coalesce((SELECT sum(amount) FROM supplier_payments sp WHERE sp.purchase_id = ${purchases.id}), 0)::bigint`;
  const [rows, [counted]] = await Promise.all([
    db
      .select({
        id: purchases.id,
        purchaseNumber: purchases.purchaseNumber,
        supplierId: purchases.supplierId,
        supplierName: suppliers.name,
        status: purchases.status,
        purchaseDate: purchases.purchaseDate,
        supplierReference: purchases.supplierReference,
        total: purchases.total,
        paid,
      })
      .from(purchases)
      .innerJoin(suppliers, eq(suppliers.id, purchases.supplierId))
      .where(where)
      .orderBy(desc(purchases.purchaseDate), desc(purchases.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(purchases).where(where),
  ]);
  return {
    items: rows.map((r) => ({ ...r, outstanding: r.status === "CANCELLED" ? 0 : r.total - r.paid })),
    total: counted?.n ?? 0,
    page,
    pageSize,
  };
}

export async function getPurchase(db: DbClient, id: string) {
  const [header] = await db
    .select({ purchase: purchases, supplierName: suppliers.name, createdByName: users.fullName })
    .from(purchases)
    .innerJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .leftJoin(users, eq(users.id, purchases.createdBy))
    .where(eq(purchases.id, id));
  if (!header) throw notFound("Purchase");
  const [items, payments] = await Promise.all([
    db
      .select({
        id: purchaseItems.id,
        productId: purchaseItems.productId,
        productName: products.name,
        sku: products.sku,
        quantity: purchaseItems.quantity,
        unitCost: purchaseItems.unitCost,
        lineTotal: purchaseItems.lineTotal,
      })
      .from(purchaseItems)
      .innerJoin(products, eq(products.id, purchaseItems.productId))
      .where(eq(purchaseItems.purchaseId, id))
      .orderBy(products.name),
    db
      .select({
        id: supplierPayments.id,
        paymentNumber: supplierPayments.paymentNumber,
        kind: supplierPayments.kind,
        method: supplierPayments.method,
        amount: supplierPayments.amount,
        reversesPaymentId: supplierPayments.reversesPaymentId,
        externalReference: supplierPayments.externalReference,
        notes: supplierPayments.notes,
        paidAt: supplierPayments.paidAt,
        paidByName: users.fullName,
      })
      .from(supplierPayments)
      .leftJoin(users, eq(users.id, supplierPayments.paidBy))
      .where(eq(supplierPayments.purchaseId, id))
      .orderBy(supplierPayments.paidAt),
  ]);
  const paid = payments.reduce((sum, p) => sum + p.amount, 0);
  const reversedIds = new Set(payments.map((p) => p.reversesPaymentId).filter(Boolean));
  return {
    ...header.purchase,
    supplierName: header.supplierName,
    createdByName: header.createdByName,
    items,
    payments: payments.map((p) => ({ ...p, isReversed: reversedIds.has(p.id) })),
    paid,
    outstanding: header.purchase.status === "CANCELLED" ? 0 : header.purchase.total - paid,
  };
}
