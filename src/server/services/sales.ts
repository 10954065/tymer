import { and, desc, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { AppError, notFound } from "@/lib/errors";
import type { DateRange } from "@/lib/dates";
import { priceCart, settleTenders, type CartLineInput, type TenderInput } from "@/lib/pricing";
import type { Database, DbClient, Tx } from "@/server/db/client";
import {
  businessSettings,
  customers,
  inventoryMovements,
  payments,
  products,
  saleItems,
  saleReturnItems,
  saleReturns,
  sales,
  users,
} from "@/server/db/schema";
import { recordAudit } from "./audit";

export { priceCart, settleTenders };
import { applyStockChange, lockProducts } from "./inventory";
import { getSaleBalance, insertPayment } from "./payments";
import type { Actor } from "./users";

// ---------------------------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------------------------

export interface CheckoutInput {
  idempotencyKey: string;
  customerId: string | null;
  items: { productId: string; quantity: number; discount?: number; unitPrice?: number }[];
  cartDiscount?: number;
  payments: TenderInput[];
  notes?: string | null;
  source?: "POS" | "OFFLINE";
  deviceId?: string | null;
  clientCreatedAt?: Date | null;
}

export interface CheckoutOptions {
  /** Actor may exceed the cashier discount limit. */
  canOverrideDiscount: boolean;
  /** Use prices supplied by the client (owner-approved offline sales only). */
  useClientPrices?: boolean;
  /** Owner-approved override of the negative stock rule (offline conflicts only). */
  allowNegativeStock?: boolean;
}

export interface CheckoutResult {
  saleId: string;
  saleNumber: string;
  total: number;
  paid: number;
  change: number;
  balance: number;
  duplicate: boolean;
}

async function findByIdempotencyKey(db: DbClient, key: string): Promise<CheckoutResult | null> {
  const [existing] = await db.select({ id: sales.id, saleNumber: sales.saleNumber, total: sales.total }).from(sales).where(eq(sales.idempotencyKey, key));
  if (!existing) return null;
  const { paid, balance } = await getSaleBalance(db, existing.id);
  return { saleId: existing.id, saleNumber: existing.saleNumber, total: existing.total, paid, change: 0, balance, duplicate: true };
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const e = error as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const pg = e?.code ? e : e?.cause;
  return pg?.code === "23505" && pg?.constraint === constraint;
}

/**
 * Records a sale atomically: validates stock and prices, snapshots lines, deducts stock through the ledger and records
 * payments. Replaying the same idempotency key returns the original sale instead of creating a duplicate.
 */
export async function checkout(db: Database, actor: Actor, input: CheckoutInput, options: CheckoutOptions): Promise<CheckoutResult> {
  if (!input.idempotencyKey || input.idempotencyKey.length > 100) throw new AppError("VALIDATION", "Missing idempotency key");
  const existing = await findByIdempotencyKey(db, input.idempotencyKey);
  if (existing) return existing;
  try {
    return await db.transaction((tx) => checkoutInTransaction(tx, actor, input, options));
  } catch (error) {
    // A concurrent request with the same key won the race: return its sale.
    if (isUniqueViolation(error, "sales_idempotency_uq")) {
      const winner = await findByIdempotencyKey(db, input.idempotencyKey);
      if (winner) return winner;
    }
    throw error;
  }
}

async function checkoutInTransaction(tx: Tx, actor: Actor, input: CheckoutInput, options: CheckoutOptions): Promise<CheckoutResult> {
  const [settings] = await tx.select().from(businessSettings).where(eq(businessSettings.id, 1));
  const allowNegative = options.allowNegativeStock || (settings?.allowNegativeStock ?? false);
  const productIds = input.items.map((i) => i.productId);
  if (new Set(productIds).size !== productIds.length) throw new AppError("VALIDATION", "Each product should appear once in the cart");

  if (input.customerId) {
    const [customer] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, input.customerId));
    if (!customer) throw notFound("Customer");
  }

  await lockProducts(tx, productIds);
  const rows = await tx
    .select({ id: products.id, name: products.name, sku: products.sku, status: products.status, quantity: products.quantity, costPrice: products.costPrice, sellingPrice: products.sellingPrice })
    .from(products)
    .where(inArray(products.id, productIds));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const lines: CartLineInput[] = input.items.map((item) => {
    const product = byId.get(item.productId);
    if (!product) throw new AppError("NOT_FOUND", "A product in the cart no longer exists");
    const sellable = product.status === "ACTIVE" || ((allowNegative || options.useClientPrices) && product.status === "OUT_OF_STOCK");
    if (!sellable && !options.allowNegativeStock) {
      throw new AppError("INSUFFICIENT_STOCK", `${product.name} is no longer available for sale`, { details: { productId: product.id, available: product.quantity } });
    }
    const unitPrice = options.useClientPrices && item.unitPrice !== undefined ? item.unitPrice : product.sellingPrice;
    return { productId: product.id, quantity: item.quantity, unitPrice, discount: item.discount ?? 0 };
  });

  const cart = priceCart(lines, input.cartDiscount ?? 0, settings?.taxRateBps ?? 0);
  const maxDiscountBps = settings?.cashierMaxDiscountBps ?? 1000;
  if (!options.canOverrideDiscount && cart.discountTotal * 10_000 > cart.subtotal * maxDiscountBps) {
    throw new AppError("FORBIDDEN", `Discounts above ${maxDiscountBps / 100}% need a manager or owner`);
  }

  const settlement = settleTenders(cart.total, input.payments);
  if (settlement.paid < cart.total && !input.customerId) {
    throw new AppError("VALIDATION", "Select a customer to sell on credit or take a part payment");
  }

  const costTotal = cart.lines.reduce((sum, line) => sum + line.quantity * byId.get(line.productId)!.costPrice, 0);
  const [sale] = await tx
    .insert(sales)
    .values({
      idempotencyKey: input.idempotencyKey,
      customerId: input.customerId,
      subtotal: cart.subtotal,
      discountTotal: cart.discountTotal,
      taxTotal: cart.taxTotal,
      total: cart.total,
      costTotal,
      source: input.source ?? "POS",
      deviceId: input.deviceId ?? null,
      clientCreatedAt: input.clientCreatedAt ?? null,
      notes: input.notes ?? null,
      createdBy: actor.id,
    })
    .returning({ id: sales.id, saleNumber: sales.saleNumber });

  await tx.insert(saleItems).values(
    cart.lines.map((line) => {
      const product = byId.get(line.productId)!;
      return {
        saleId: sale.id,
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity: line.quantity,
        unitCost: product.costPrice,
        unitPrice: line.unitPrice,
        discount: line.totalDiscount,
        tax: line.tax,
        lineTotal: line.lineTotal,
      };
    }),
  );

  for (const line of [...cart.lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
    await applyStockChange(
      tx,
      {
        productId: line.productId,
        type: "SALE",
        quantityChange: -line.quantity,
        unitCost: byId.get(line.productId)!.costPrice,
        referenceType: "sale",
        referenceId: sale.id,
        userId: actor.id,
        allowNegative: options.allowNegativeStock,
      },
      allowNegative,
    );
  }

  for (const tender of settlement.recorded) {
    await insertPayment(tx, {
      kind: "RECEIPT",
      method: tender.method,
      amount: tender.amount,
      saleId: sale.id,
      customerId: input.customerId,
      externalReference: tender.externalReference ?? null,
      receivedBy: actor.id,
    });
  }

  await recordAudit(tx, {
    userId: actor.id,
    action: "sale.created",
    entityType: "sale",
    entityId: sale.id,
    reference: sale.saleNumber,
    after: { total: cart.total, discount: cart.discountTotal, paid: settlement.paid, items: cart.lines.length, source: input.source ?? "POS" },
  });

  return {
    saleId: sale.id,
    saleNumber: sale.saleNumber,
    total: cart.total,
    paid: settlement.paid,
    change: settlement.change,
    balance: cart.total - settlement.paid,
    duplicate: false,
  };
}

// ---------------------------------------------------------------------------------------------
// Void
// ---------------------------------------------------------------------------------------------

/**
 * Cancels a sale entered by mistake: restores stock with REVERSAL movements and cancels every payment with a REVERSAL
 * entry. Sales with returns cannot be voided (the return already adjusted them).
 */
export async function voidSale(tx: Tx, actor: Actor, input: { saleId: string; reason: string }): Promise<void> {
  const [sale] = await tx.select().from(sales).where(eq(sales.id, input.saleId)).for("update");
  if (!sale) throw notFound("Sale");
  if (sale.status === "VOIDED") throw new AppError("CONFLICT", "This sale is already voided");
  const [ret] = await tx.select({ id: saleReturns.id }).from(saleReturns).where(eq(saleReturns.saleId, sale.id)).limit(1);
  if (ret) throw new AppError("CONFLICT", "This sale has returns and cannot be voided");

  const items = await tx.select().from(saleItems).where(eq(saleItems.saleId, sale.id)).orderBy(saleItems.productId);
  for (const item of items) {
    await applyStockChange(tx, {
      productId: item.productId,
      type: "REVERSAL",
      quantityChange: item.quantity,
      unitCost: item.unitCost,
      referenceType: "sale_void",
      referenceId: sale.id,
      reason: `Void ${sale.saleNumber}: ${input.reason}`,
      userId: actor.id,
    });
  }

  const salePayments = await tx.select().from(payments).where(eq(payments.saleId, sale.id));
  const reversed = new Set(salePayments.map((p) => p.reversesPaymentId).filter(Boolean));
  for (const p of salePayments) {
    if (p.kind !== "RECEIPT" || reversed.has(p.id)) continue;
    await insertPayment(tx, {
      kind: "REVERSAL",
      method: p.method,
      amount: -p.amount,
      saleId: sale.id,
      customerId: p.customerId,
      reversesPaymentId: p.id,
      notes: `Sale voided: ${input.reason}`,
      receivedBy: actor.id,
    });
  }

  await tx.update(sales).set({ status: "VOIDED", voidedAt: new Date(), voidedBy: actor.id, voidReason: input.reason }).where(eq(sales.id, sale.id));
  await recordAudit(tx, {
    userId: actor.id,
    action: "sale.voided",
    entityType: "sale",
    entityId: sale.id,
    reference: sale.saleNumber,
    reason: input.reason,
    before: { status: "COMPLETED", total: sale.total },
    after: { status: "VOIDED" },
  });
}

// ---------------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------------

export interface SaleListItem {
  id: string;
  saleNumber: string;
  createdAt: Date;
  status: "COMPLETED" | "VOIDED";
  source: string;
  customerName: string | null;
  cashierName: string | null;
  total: number;
  paid: number;
  returned: number;
  balance: number;
}

export async function listSales(
  db: DbClient,
  options: { search?: string; range?: DateRange; status?: "COMPLETED" | "VOIDED"; customerId?: string; onlyUnpaid?: boolean; page?: number; pageSize?: number } = {},
): Promise<{ items: SaleListItem[]; total: number; page: number; pageSize: number }> {
  const pageSize = Math.min(Math.max(options.pageSize ?? 25, 5), 100);
  const page = Math.max(options.page ?? 1, 1);
  const q = options.search?.trim();
  const paid = sql<number>`coalesce((SELECT sum(amount) FROM payments p WHERE p.sale_id = ${sales.id}), 0)::bigint`;
  const returned = sql<number>`coalesce((SELECT sum(value_total + tax_total) FROM sale_returns r WHERE r.sale_id = ${sales.id}), 0)::bigint`;
  const where = and(
    options.range ? gte(sales.createdAt, options.range.start) : undefined,
    options.range ? lt(sales.createdAt, options.range.end) : undefined,
    options.status ? eq(sales.status, options.status) : undefined,
    options.customerId ? eq(sales.customerId, options.customerId) : undefined,
    q ? or(ilike(sales.saleNumber, `%${q}%`), ilike(customers.fullName, `%${q}%`)) : undefined,
    options.onlyUnpaid ? sql`${sales.status} = 'COMPLETED' AND ${sales.total} - ${returned} - ${paid} > 0` : undefined,
  );
  const [rows, [counted]] = await Promise.all([
    db
      .select({
        id: sales.id,
        saleNumber: sales.saleNumber,
        createdAt: sales.createdAt,
        status: sales.status,
        source: sales.source,
        customerName: customers.fullName,
        cashierName: users.fullName,
        total: sales.total,
        paid,
        returned,
      })
      .from(sales)
      .leftJoin(customers, eq(customers.id, sales.customerId))
      .leftJoin(users, eq(users.id, sales.createdBy))
      .where(where)
      .orderBy(desc(sales.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(sales).leftJoin(customers, eq(customers.id, sales.customerId)).where(where),
  ]);
  return {
    items: rows.map((r) => ({ ...r, balance: r.status === "VOIDED" ? 0 : r.total - r.returned - r.paid })),
    total: counted?.n ?? 0,
    page,
    pageSize,
  };
}

export async function getSale(db: DbClient, id: string) {
  const [header] = await db
    .select({ sale: sales, customerName: customers.fullName, customerPhone: customers.phone, cashierName: users.fullName })
    .from(sales)
    .leftJoin(customers, eq(customers.id, sales.customerId))
    .leftJoin(users, eq(users.id, sales.createdBy))
    .where(eq(sales.id, id));
  if (!header) throw notFound("Sale");
  const [items, salePayments, returns] = await Promise.all([
    db.select().from(saleItems).where(eq(saleItems.saleId, id)).orderBy(saleItems.productName),
    db
      .select({
        id: payments.id,
        paymentNumber: payments.paymentNumber,
        kind: payments.kind,
        method: payments.method,
        amount: payments.amount,
        externalReference: payments.externalReference,
        reversesPaymentId: payments.reversesPaymentId,
        notes: payments.notes,
        receivedAt: payments.receivedAt,
        receivedByName: users.fullName,
      })
      .from(payments)
      .leftJoin(users, eq(users.id, payments.receivedBy))
      .where(eq(payments.saleId, id))
      .orderBy(payments.receivedAt),
    db
      .select({
        id: saleReturns.id,
        returnNumber: saleReturns.returnNumber,
        reason: saleReturns.reason,
        valueTotal: saleReturns.valueTotal,
        taxTotal: saleReturns.taxTotal,
        createdAt: saleReturns.createdAt,
        createdByName: users.fullName,
      })
      .from(saleReturns)
      .leftJoin(users, eq(users.id, saleReturns.createdBy))
      .where(eq(saleReturns.saleId, id))
      .orderBy(saleReturns.createdAt),
  ]);
  const returnItems = returns.length
    ? await db
        .select({ returnId: saleReturnItems.returnId, saleItemId: saleReturnItems.saleItemId, quantity: saleReturnItems.quantity, restocked: saleReturnItems.restocked })
        .from(saleReturnItems)
        .where(inArray(saleReturnItems.returnId, returns.map((r) => r.id)))
    : [];
  const balance = await getSaleBalance(db, id);
  const reversedIds = new Set(salePayments.map((p) => p.reversesPaymentId).filter(Boolean));
  return {
    ...header.sale,
    customerName: header.customerName,
    customerPhone: header.customerPhone,
    cashierName: header.cashierName,
    items,
    payments: salePayments.map((p) => ({ ...p, isReversed: reversedIds.has(p.id) })),
    returns: returns.map((r) => ({ ...r, items: returnItems.filter((i) => i.returnId === r.id) })),
    ...balance,
  };
}

export type SaleDetail = Awaited<ReturnType<typeof getSale>>;

/** Units sold per product for a sale (used to cross-check the stock ledger in tests and health checks). */
export async function saleMovementTotal(db: DbClient, saleId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${inventoryMovements.quantityChange}), 0)::int` })
    .from(inventoryMovements)
    .where(and(eq(inventoryMovements.referenceType, "sale"), eq(inventoryMovements.referenceId, saleId)));
  return row?.n ?? 0;
}
