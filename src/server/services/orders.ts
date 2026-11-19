import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { AppError, notFound } from "@/lib/errors";
import type { PaymentMethod } from "@/lib/validation/common";
import type { DbClient, Tx } from "@/server/db/client";
import { customers, expenseCategories, expenses, orderItems, orders, payments, products, users } from "@/server/db/schema";
import { diffFields, recordAudit } from "./audit";
import { applyStockChange, lockProducts } from "./inventory";
import { getOrderNetPaid, insertPayment } from "./payments";
import type { Actor } from "./users";

export type OrderStatus = (typeof orders.$inferSelect)["status"];

export interface OrderItemInput {
  kind: "PRODUCT" | "SERVICE";
  productId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface OrderInput {
  customerId: string;
  title: string;
  description: string | null;
  items: OrderItemInput[];
  estimatedMaterialsCost: number;
  estimatedLabourCost: number;
  expectedCompletionDate: string | null;
  fulfilment: "COLLECTION" | "DELIVERY";
  deliveryAddress: string | null;
  deliveryNotes: string | null;
  internalNotes: string | null;
}

const OPEN: OrderStatus[] = ["NEW", "DEPOSIT_PAID", "IN_PROGRESS", "READY"];

function validateItems(items: OrderItemInput[]) {
  if (items.length === 0) throw new AppError("VALIDATION", "Add at least one product or service");
  for (const item of items) {
    if (item.kind === "PRODUCT" && !item.productId) throw new AppError("VALIDATION", "Choose the product for each product line");
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new AppError("VALIDATION", "Quantities must be whole numbers above zero");
    if (!Number.isInteger(item.unitPrice) || item.unitPrice < 0) throw new AppError("VALIDATION", "Prices cannot be negative");
  }
}

async function writeItems(tx: Tx, orderId: string, items: OrderItemInput[]): Promise<number> {
  await tx.insert(orderItems).values(
    items.map((i) => ({
      orderId,
      kind: i.kind,
      productId: i.kind === "PRODUCT" ? i.productId : null,
      description: i.description,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      lineTotal: i.quantity * i.unitPrice,
    })),
  );
  return items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
}

function headerValues(input: OrderInput) {
  return {
    customerId: input.customerId,
    title: input.title,
    description: input.description,
    estimatedMaterialsCost: input.estimatedMaterialsCost,
    estimatedLabourCost: input.estimatedLabourCost,
    expectedCompletionDate: input.expectedCompletionDate,
    fulfilment: input.fulfilment,
    deliveryAddress: input.deliveryAddress,
    deliveryNotes: input.deliveryNotes,
    internalNotes: input.internalNotes,
  };
}

export async function createOrder(tx: Tx, actor: Actor, input: OrderInput): Promise<{ id: string; orderNumber: string }> {
  validateItems(input.items);
  const [customer] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, input.customerId));
  if (!customer) throw notFound("Customer");
  const [order] = await tx.insert(orders).values({ ...headerValues(input), createdBy: actor.id }).returning({ id: orders.id, orderNumber: orders.orderNumber });
  const totalAmount = await writeItems(tx, order.id, input.items);
  await tx.update(orders).set({ totalAmount }).where(eq(orders.id, order.id));
  await recordAudit(tx, { userId: actor.id, action: "order.created", entityType: "order", entityId: order.id, reference: order.orderNumber, after: { title: input.title, totalAmount } });
  return order;
}

async function lockOrder(tx: Tx, id: string) {
  const [order] = await tx.select().from(orders).where(eq(orders.id, id)).for("update");
  if (!order) throw notFound("Order");
  return order;
}

export async function updateOrder(tx: Tx, actor: Actor, id: string, input: OrderInput): Promise<void> {
  validateItems(input.items);
  const current = await lockOrder(tx, id);
  if (!OPEN.includes(current.status)) throw new AppError("CONFLICT", `A ${current.status.toLowerCase()} order cannot be edited`);
  await tx.delete(orderItems).where(eq(orderItems.orderId, id));
  const totalAmount = await writeItems(tx, id, input.items);
  const paid = await getOrderNetPaid(tx, id);
  if (totalAmount < paid) throw new AppError("VALIDATION", "The new total is less than what the customer has already paid");
  const next = { ...headerValues(input), totalAmount };
  const changes = diffFields(current as unknown as Record<string, unknown>, next);
  await tx.update(orders).set(next).where(eq(orders.id, id));
  if (changes) await recordAudit(tx, { userId: actor.id, action: "order.updated", entityType: "order", entityId: id, reference: current.orderNumber, ...changes });
}

const ALLOWED_MANUAL: Record<string, OrderStatus[]> = {
  NEW: ["IN_PROGRESS", "READY"],
  DEPOSIT_PAID: ["IN_PROGRESS", "READY"],
  IN_PROGRESS: ["READY"],
  READY: ["IN_PROGRESS"],
};

export async function setOrderStatus(tx: Tx, actor: Actor, id: string, status: OrderStatus): Promise<void> {
  const order = await lockOrder(tx, id);
  if (!(ALLOWED_MANUAL[order.status] ?? []).includes(status)) {
    throw new AppError("CONFLICT", `Cannot move an order from ${order.status} to ${status}`);
  }
  await tx.update(orders).set({ status }).where(eq(orders.id, id));
  await recordAudit(tx, { userId: actor.id, action: "order.status", entityType: "order", entityId: id, reference: order.orderNumber, before: { status: order.status }, after: { status } });
}

/** Deposits and additional payments. Payments are money received, never revenue by themselves. */
export async function recordOrderPayment(
  tx: Tx,
  actor: Actor,
  input: { orderId: string; amount: number; method: PaymentMethod; externalReference: string | null; notes: string | null },
): Promise<{ id: string; paymentNumber: string }> {
  const order = await lockOrder(tx, input.orderId);
  if (order.status === "CANCELLED") throw new AppError("CONFLICT", "Cannot take payment on a cancelled order");
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new AppError("VALIDATION", "Amount must be greater than zero");
  const outstanding = order.totalAmount - (await getOrderNetPaid(tx, order.id));
  if (input.amount > outstanding) {
    throw new AppError("VALIDATION", outstanding <= 0 ? "This order is fully paid" : "Payment is more than the balance owed", { fieldErrors: { amount: "Exceeds balance" } });
  }
  const payment = await insertPayment(tx, { kind: "RECEIPT", ...input, customerId: order.customerId, receivedBy: actor.id });
  if (order.status === "NEW") await tx.update(orders).set({ status: "DEPOSIT_PAID" }).where(eq(orders.id, order.id));
  await recordAudit(tx, { userId: actor.id, action: "order.payment", entityType: "order", entityId: order.id, reference: payment.paymentNumber, after: { amount: input.amount, method: input.method } });
  return payment;
}

/**
 * Completes the order: revenue is recognised now (total amount), stocked products are deducted from inventory with
 * their current cost snapshotted on the order item, and the product cost is stored for profitability.
 */
export async function completeOrder(tx: Tx, actor: Actor, id: string): Promise<void> {
  const order = await lockOrder(tx, id);
  if (!OPEN.includes(order.status)) throw new AppError("CONFLICT", `A ${order.status.toLowerCase()} order cannot be completed`);
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, id));
  const productIds = items.filter((i) => i.productId).map((i) => i.productId as string);
  await lockProducts(tx, productIds);
  const costs = productIds.length
    ? await tx.select({ id: products.id, costPrice: products.costPrice }).from(products).where(inArray(products.id, productIds))
    : [];
  const costById = new Map(costs.map((c) => [c.id, c.costPrice]));
  let productCostTotal = 0;
  for (const item of items.filter((i) => i.productId).sort((a, b) => a.productId!.localeCompare(b.productId!))) {
    const unitCost = costById.get(item.productId!) ?? 0;
    await applyStockChange(tx, {
      productId: item.productId!,
      type: "SALE",
      quantityChange: -item.quantity,
      unitCost,
      referenceType: "order",
      referenceId: id,
      reason: `Order ${order.orderNumber}`,
      userId: actor.id,
    });
    await tx.update(orderItems).set({ unitCost }).where(eq(orderItems.id, item.id));
    productCostTotal += unitCost * item.quantity;
  }
  await tx.update(orders).set({ status: "COMPLETED", completedAt: new Date(), productCostTotal }).where(eq(orders.id, id));
  await recordAudit(tx, { userId: actor.id, action: "order.completed", entityType: "order", entityId: id, reference: order.orderNumber, after: { totalAmount: order.totalAmount, productCostTotal } });
}

/** Cancels an open order. Money already received can be refunded (up to the net amount paid). */
export async function cancelOrder(
  tx: Tx,
  actor: Actor,
  input: { orderId: string; reason: string; refund: { method: PaymentMethod; amount: number } | null },
): Promise<void> {
  const order = await lockOrder(tx, input.orderId);
  if (!OPEN.includes(order.status)) throw new AppError("CONFLICT", `A ${order.status.toLowerCase()} order cannot be cancelled`);
  if (input.refund && input.refund.amount > 0) {
    const paid = await getOrderNetPaid(tx, order.id);
    if (input.refund.amount > paid) throw new AppError("VALIDATION", "The refund is more than the customer paid");
    await insertPayment(tx, { kind: "REFUND", method: input.refund.method, amount: -input.refund.amount, orderId: order.id, customerId: order.customerId, notes: input.reason, receivedBy: actor.id });
  }
  await tx.update(orders).set({ status: "CANCELLED", cancelledAt: new Date(), cancelReason: input.reason }).where(eq(orders.id, order.id));
  await recordAudit(tx, { userId: actor.id, action: "order.cancelled", entityType: "order", entityId: order.id, reference: order.orderNumber, reason: input.reason, after: { refunded: input.refund?.amount ?? 0 } });
}

export interface OrderListItem {
  id: string;
  orderNumber: string;
  title: string;
  status: OrderStatus;
  customerId: string;
  customerName: string;
  totalAmount: number;
  paid: number;
  outstanding: number;
  expectedCompletionDate: string | null;
  createdAt: Date;
}

export async function listOrders(
  db: DbClient,
  options: { status?: OrderStatus | "OPEN"; search?: string; customerId?: string; page?: number; pageSize?: number } = {},
): Promise<{ items: OrderListItem[]; total: number; page: number; pageSize: number }> {
  const pageSize = Math.min(Math.max(options.pageSize ?? 25, 5), 100);
  const page = Math.max(options.page ?? 1, 1);
  const q = options.search?.trim();
  const where = and(
    options.status === "OPEN" ? inArray(orders.status, OPEN) : options.status ? eq(orders.status, options.status) : undefined,
    options.customerId ? eq(orders.customerId, options.customerId) : undefined,
    q ? or(ilike(orders.orderNumber, `%${q}%`), ilike(orders.title, `%${q}%`), ilike(customers.fullName, `%${q}%`)) : undefined,
  );
  const paid = sql<number>`coalesce((SELECT sum(amount) FROM payments p WHERE p.order_id = ${orders.id}), 0)::bigint`;
  const [rows, [counted]] = await Promise.all([
    db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        title: orders.title,
        status: orders.status,
        customerId: orders.customerId,
        customerName: customers.fullName,
        totalAmount: orders.totalAmount,
        paid,
        expectedCompletionDate: orders.expectedCompletionDate,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(orders).innerJoin(customers, eq(customers.id, orders.customerId)).where(where),
  ]);
  return {
    items: rows.map((r) => ({ ...r, outstanding: r.status === "CANCELLED" ? 0 : r.totalAmount - r.paid })),
    total: counted?.n ?? 0,
    page,
    pageSize,
  };
}

export async function getOrder(db: DbClient, id: string) {
  const [header] = await db
    .select({ order: orders, customerName: customers.fullName, customerPhone: customers.phone, createdByName: users.fullName })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .leftJoin(users, eq(users.id, orders.createdBy))
    .where(eq(orders.id, id));
  if (!header) throw notFound("Order");
  const [items, orderPayments, directCosts] = await Promise.all([
    db.select({ item: orderItems, sku: products.sku }).from(orderItems).leftJoin(products, eq(products.id, orderItems.productId)).where(eq(orderItems.orderId, id)),
    db
      .select({
        id: payments.id,
        paymentNumber: payments.paymentNumber,
        kind: payments.kind,
        method: payments.method,
        amount: payments.amount,
        reversesPaymentId: payments.reversesPaymentId,
        externalReference: payments.externalReference,
        receivedAt: payments.receivedAt,
        receivedByName: users.fullName,
      })
      .from(payments)
      .leftJoin(users, eq(users.id, payments.receivedBy))
      .where(eq(payments.orderId, id))
      .orderBy(payments.receivedAt),
    db
      .select({ id: expenses.id, expenseNumber: expenses.expenseNumber, description: expenses.description, amount: expenses.amount, expenseDate: expenses.expenseDate, category: expenseCategories.name })
      .from(expenses)
      .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
      .where(eq(expenses.orderId, id))
      .orderBy(expenses.expenseDate),
  ]);
  const o = header.order;
  const paid = orderPayments.reduce((s, p) => s + p.amount, 0);
  const directCostTotal = directCosts.reduce((s, e) => s + e.amount, 0);
  const reversed = new Set(orderPayments.map((p) => p.reversesPaymentId).filter(Boolean));
  return {
    ...o,
    customerName: header.customerName,
    customerPhone: header.customerPhone,
    createdByName: header.createdByName,
    items: items.map((r) => ({ ...r.item, sku: r.sku })),
    payments: orderPayments.map((p) => ({ ...p, isReversed: reversed.has(p.id) })),
    directCosts,
    paid,
    outstanding: o.status === "CANCELLED" ? 0 : o.totalAmount - paid,
    estimatedProfit: o.totalAmount - o.estimatedMaterialsCost - o.estimatedLabourCost,
    directCostTotal,
    /** Final profit once completed: agreed price − stocked products used − direct costs (materials/labour expenses). */
    actualProfit: o.status === "COMPLETED" ? o.totalAmount - o.productCostTotal - directCostTotal : null,
  };
}

export type OrderDetail = Awaited<ReturnType<typeof getOrder>>;
