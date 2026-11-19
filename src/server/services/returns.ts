import { eq, inArray } from "drizzle-orm";
import { AppError, notFound } from "@/lib/errors";
import { mulDivRound } from "@/lib/money";
import type { PaymentMethod } from "@/lib/validation/common";
import type { Tx } from "@/server/db/client";
import { saleItems, saleReturnItems, saleReturns, sales } from "@/server/db/schema";
import { recordAudit } from "./audit";
import { applyStockChange } from "./inventory";
import { getSaleBalance, insertPayment } from "./payments";
import type { Actor } from "./users";

export interface ReturnInput {
  saleId: string;
  idempotencyKey: string;
  reason: string;
  items: { saleItemId: string; quantity: number; restock: boolean }[];
  refund: { method: PaymentMethod; amount: number } | null;
}

/**
 * Share of a line's value for units `from`..`to` (exclusive) of `quantity`. Computing cumulative differences means
 * several partial returns always add up exactly to the full line value.
 */
export function proRataSlice(value: number, quantity: number, from: number, to: number): number {
  return mulDivRound(value, to, quantity) - mulDivRound(value, from, quantity);
}

/**
 * Records a customer return: reduces revenue (in the period of the return), restocks goods that are physically
 * accepted back (CUSTOMER_RETURN movement at the original cost) and optionally refunds money (capped by what was paid).
 */
export async function createReturn(
  tx: Tx,
  actor: Actor,
  input: ReturnInput,
): Promise<{ returnId: string; returnNumber: string; value: number; refunded: number; duplicate: boolean }> {
  const [existing] = await tx.select().from(saleReturns).where(eq(saleReturns.idempotencyKey, input.idempotencyKey));
  if (existing) return { returnId: existing.id, returnNumber: existing.returnNumber, value: existing.valueTotal + existing.taxTotal, refunded: 0, duplicate: true };

  const [sale] = await tx.select().from(sales).where(eq(sales.id, input.saleId)).for("update");
  if (!sale) throw notFound("Sale");
  if (sale.status !== "COMPLETED") throw new AppError("CONFLICT", "Returns can only be made against completed sales");
  if (input.items.length === 0) throw new AppError("VALIDATION", "Select at least one item to return");
  if (input.reason.trim().length < 3) throw new AppError("VALIDATION", "Give a reason for the return");

  const ids = input.items.map((i) => i.saleItemId);
  const lines = await tx.select().from(saleItems).where(inArray(saleItems.id, ids)).for("update");
  const byId = new Map(lines.map((l) => [l.id, l]));

  const computed = input.items.map((item) => {
    const line = byId.get(item.saleItemId);
    if (!line || line.saleId !== sale.id) throw new AppError("VALIDATION", "An item does not belong to this sale");
    const returnable = line.quantity - line.returnedQuantity;
    if (!Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > returnable) {
      throw new AppError("VALIDATION", `Only ${returnable} × ${line.productName} can still be returned`);
    }
    const net = line.lineTotal - line.tax;
    const from = line.returnedQuantity;
    const to = line.returnedQuantity + item.quantity;
    return {
      line,
      quantity: item.quantity,
      restock: item.restock,
      value: proRataSlice(net, line.quantity, from, to),
      tax: proRataSlice(line.tax, line.quantity, from, to),
    };
  });

  const valueTotal = computed.reduce((s, c) => s + c.value, 0);
  const taxTotal = computed.reduce((s, c) => s + c.tax, 0);
  const restockedCostTotal = computed.filter((c) => c.restock).reduce((s, c) => s + c.quantity * c.line.unitCost, 0);

  const [ret] = await tx
    .insert(saleReturns)
    .values({ saleId: sale.id, idempotencyKey: input.idempotencyKey, reason: input.reason.trim(), valueTotal, taxTotal, restockedCostTotal, createdBy: actor.id })
    .returning({ id: saleReturns.id, returnNumber: saleReturns.returnNumber });

  for (const c of computed) {
    await tx.insert(saleReturnItems).values({
      returnId: ret.id,
      saleItemId: c.line.id,
      quantity: c.quantity,
      restocked: c.restock,
      value: c.value,
      tax: c.tax,
      unitCost: c.line.unitCost,
    });
    await tx.update(saleItems).set({ returnedQuantity: c.line.returnedQuantity + c.quantity }).where(eq(saleItems.id, c.line.id));
    if (c.restock) {
      await applyStockChange(tx, {
        productId: c.line.productId,
        type: "CUSTOMER_RETURN",
        quantityChange: c.quantity,
        unitCost: c.line.unitCost,
        referenceType: "return",
        referenceId: ret.id,
        reason: `${ret.returnNumber}: ${input.reason.trim()}`,
        userId: actor.id,
      });
    }
  }

  let refunded = 0;
  if (input.refund && input.refund.amount > 0) {
    // After the return, the customer may be owed money only if they paid more than the remaining sale value.
    const { paid, balance } = await getSaleBalance(tx, sale.id);
    const refundable = Math.max(0, Math.min(valueTotal + taxTotal, -balance, paid));
    if (input.refund.amount > refundable) {
      throw new AppError("VALIDATION", `The refund can be at most ${refundable / 100} cedis for this return`, { fieldErrors: { refund: "Too large" } });
    }
    await insertPayment(tx, {
      kind: "REFUND",
      method: input.refund.method,
      amount: -input.refund.amount,
      saleId: sale.id,
      customerId: sale.customerId,
      returnId: ret.id,
      notes: input.reason.trim(),
      receivedBy: actor.id,
    });
    refunded = input.refund.amount;
  }

  await recordAudit(tx, {
    userId: actor.id,
    action: "sale.returned",
    entityType: "sale",
    entityId: sale.id,
    reference: ret.returnNumber,
    reason: input.reason.trim(),
    after: { value: valueTotal + taxTotal, refunded, restockedItems: computed.filter((c) => c.restock).length },
  });
  return { returnId: ret.id, returnNumber: ret.returnNumber, value: valueTotal + taxTotal, refunded, duplicate: false };
}
