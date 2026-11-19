import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { AppError, notFound } from "@/lib/errors";
import type { DateRange } from "@/lib/dates";
import type { PaymentMethod } from "@/lib/validation/common";
import type { DbClient, Tx } from "@/server/db/client";
import { customers, orders, payments, saleReturns, sales, users } from "@/server/db/schema";
import { recordAudit } from "./audit";
import type { Actor } from "./users";

export type PaymentKind = (typeof payments.$inferSelect)["kind"];

/** Net customer payments received for a sale (receipts − refunds − reversals). */
export async function getSaleNetPaid(db: DbClient, saleId: string): Promise<number> {
  const [row] = await db
    .select({ paid: sql<number>`coalesce(sum(${payments.amount}), 0)::bigint` })
    .from(payments)
    .where(eq(payments.saleId, saleId));
  return row?.paid ?? 0;
}

export async function getOrderNetPaid(db: DbClient, orderId: string): Promise<number> {
  const [row] = await db
    .select({ paid: sql<number>`coalesce(sum(${payments.amount}), 0)::bigint` })
    .from(payments)
    .where(eq(payments.orderId, orderId));
  return row?.paid ?? 0;
}

/** Sale value still owed by the customer: total − returned value (incl. tax) − net payments. */
export async function getSaleBalance(db: DbClient, saleId: string): Promise<{ total: number; returned: number; paid: number; balance: number }> {
  const [sale] = await db.select({ total: sales.total, status: sales.status }).from(sales).where(eq(sales.id, saleId));
  if (!sale) throw notFound("Sale");
  const [ret] = await db
    .select({ amt: sql<number>`coalesce(sum(${saleReturns.valueTotal} + ${saleReturns.taxTotal}), 0)::bigint` })
    .from(saleReturns)
    .where(eq(saleReturns.saleId, saleId));
  const paid = await getSaleNetPaid(db, saleId);
  const returned = ret?.amt ?? 0;
  const balance = sale.status === "VOIDED" ? 0 : sale.total - returned - paid;
  return { total: sale.total, returned, paid, balance };
}

interface NewPayment {
  kind: PaymentKind;
  method: PaymentMethod;
  amount: number;
  saleId?: string | null;
  orderId?: string | null;
  customerId?: string | null;
  returnId?: string | null;
  reversesPaymentId?: string | null;
  externalReference?: string | null;
  notes?: string | null;
  receivedBy: string;
}

export async function insertPayment(tx: Tx, payment: NewPayment): Promise<{ id: string; paymentNumber: string }> {
  const [row] = await tx
    .insert(payments)
    .values({
      kind: payment.kind,
      method: payment.method,
      amount: payment.amount,
      saleId: payment.saleId ?? null,
      orderId: payment.orderId ?? null,
      customerId: payment.customerId ?? null,
      returnId: payment.returnId ?? null,
      reversesPaymentId: payment.reversesPaymentId ?? null,
      externalReference: payment.externalReference ?? null,
      notes: payment.notes ?? null,
      receivedBy: payment.receivedBy,
    })
    .returning({ id: payments.id, paymentNumber: payments.paymentNumber });
  return row;
}

/** Records a balance payment against a completed sale (cannot exceed what is owed). */
export async function recordSalePayment(
  tx: Tx,
  actor: Actor,
  input: { saleId: string; amount: number; method: PaymentMethod; externalReference: string | null; notes: string | null },
): Promise<{ id: string; paymentNumber: string }> {
  const [sale] = await tx.select().from(sales).where(eq(sales.id, input.saleId)).for("update");
  if (!sale) throw notFound("Sale");
  if (sale.status !== "COMPLETED") throw new AppError("CONFLICT", "Payments cannot be added to a voided sale");
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new AppError("VALIDATION", "Amount must be greater than zero");
  const { balance } = await getSaleBalance(tx, sale.id);
  if (input.amount > balance) {
    throw new AppError("VALIDATION", balance <= 0 ? "This sale is already fully paid" : "Payment is more than the balance owed", {
      fieldErrors: { amount: "Exceeds balance" },
    });
  }
  const payment = await insertPayment(tx, { kind: "RECEIPT", ...input, customerId: sale.customerId, receivedBy: actor.id });
  await recordAudit(tx, {
    userId: actor.id,
    action: "payment.recorded",
    entityType: "sale",
    entityId: sale.id,
    reference: payment.paymentNumber,
    after: { amount: input.amount, method: input.method },
  });
  return payment;
}

/**
 * Corrects a mistaken receipt with an equal negative REVERSAL entry. The original row is never modified.
 * Use refunds (via returns) when money goes back to the customer for returned goods.
 */
export async function reversePayment(tx: Tx, actor: Actor, input: { paymentId: string; reason: string }): Promise<void> {
  const [original] = await tx.select().from(payments).where(eq(payments.id, input.paymentId)).for("update");
  if (!original) throw notFound("Payment");
  if (original.kind !== "RECEIPT") throw new AppError("VALIDATION", "Only received payments can be reversed");
  const [already] = await tx.select({ id: payments.id }).from(payments).where(eq(payments.reversesPaymentId, original.id));
  if (already) throw new AppError("CONFLICT", "This payment has already been reversed");
  if (original.orderId) {
    const [order] = await tx.select({ status: orders.status }).from(orders).where(eq(orders.id, original.orderId));
    if (order?.status === "CANCELLED") throw new AppError("CONFLICT", "Payments on cancelled orders are refunded, not reversed");
  }
  const reversal = await insertPayment(tx, {
    kind: "REVERSAL",
    method: original.method,
    amount: -original.amount,
    saleId: original.saleId,
    orderId: original.orderId,
    customerId: original.customerId,
    reversesPaymentId: original.id,
    notes: input.reason,
    receivedBy: actor.id,
  });
  await recordAudit(tx, {
    userId: actor.id,
    action: "payment.reversed",
    entityType: original.saleId ? "sale" : "order",
    entityId: original.saleId ?? original.orderId,
    reference: original.paymentNumber,
    reason: input.reason,
    before: { amount: original.amount },
    after: { reversal: reversal.paymentNumber },
  });
}

export interface PaymentRow {
  id: string;
  paymentNumber: string;
  kind: PaymentKind;
  method: PaymentMethod;
  amount: number;
  saleId: string | null;
  saleNumber: string | null;
  orderId: string | null;
  orderNumber: string | null;
  customerName: string | null;
  externalReference: string | null;
  notes: string | null;
  receivedByName: string | null;
  receivedAt: Date;
  reversesPaymentId: string | null;
}

export async function listPayments(
  db: DbClient,
  options: { range?: DateRange; method?: PaymentMethod; kind?: PaymentKind; customerId?: string; saleId?: string; orderId?: string; page?: number; pageSize?: number },
): Promise<{ items: PaymentRow[]; total: number; sum: number; page: number; pageSize: number }> {
  const pageSize = Math.min(Math.max(options.pageSize ?? 50, 5), 200);
  const page = Math.max(options.page ?? 1, 1);
  const where = and(
    options.range ? gte(payments.receivedAt, options.range.start) : undefined,
    options.range ? lt(payments.receivedAt, options.range.end) : undefined,
    options.method ? eq(payments.method, options.method) : undefined,
    options.kind ? eq(payments.kind, options.kind) : undefined,
    options.customerId ? eq(payments.customerId, options.customerId) : undefined,
    options.saleId ? eq(payments.saleId, options.saleId) : undefined,
    options.orderId ? eq(payments.orderId, options.orderId) : undefined,
  );
  const [items, [agg]] = await Promise.all([
    db
      .select({
        id: payments.id,
        paymentNumber: payments.paymentNumber,
        kind: payments.kind,
        method: payments.method,
        amount: payments.amount,
        saleId: payments.saleId,
        saleNumber: sales.saleNumber,
        orderId: payments.orderId,
        orderNumber: orders.orderNumber,
        customerName: customers.fullName,
        externalReference: payments.externalReference,
        notes: payments.notes,
        receivedByName: users.fullName,
        receivedAt: payments.receivedAt,
        reversesPaymentId: payments.reversesPaymentId,
      })
      .from(payments)
      .leftJoin(sales, eq(sales.id, payments.saleId))
      .leftJoin(orders, eq(orders.id, payments.orderId))
      .leftJoin(customers, eq(customers.id, payments.customerId))
      .leftJoin(users, eq(users.id, payments.receivedBy))
      .where(where)
      .orderBy(desc(payments.receivedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ n: sql<number>`count(*)::int`, sum: sql<number>`coalesce(sum(${payments.amount}), 0)::bigint` })
      .from(payments)
      .where(where),
  ]);
  return { items: items as PaymentRow[], total: agg?.n ?? 0, sum: agg?.sum ?? 0, page, pageSize };
}
