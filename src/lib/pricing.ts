/**
 * Pure cart pricing shared by the POS (live totals) and the server (authoritative checkout).
 * All values are integer pesewas.
 */
import { AppError } from "./errors";
import { allocateProRata, applyBps } from "./money";
import type { PaymentMethod } from "./validation/common";

export interface CartLineInput {
  productId: string;
  quantity: number;
  unitPrice: number;
  /** Line discount in pesewas. */
  discount: number;
}

export interface PricedLine extends CartLineInput {
  gross: number;
  /** Line discount plus its share of the cart discount. */
  totalDiscount: number;
  tax: number;
  lineTotal: number;
}

export interface PricedCart {
  lines: PricedLine[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
}

/** Prices a cart in integer pesewas. The cart discount is spread over lines so every line snapshot is exact. */
export function priceCart(lines: CartLineInput[], cartDiscount: number, taxRateBps: number): PricedCart {
  if (lines.length === 0) throw new AppError("VALIDATION", "The cart is empty");
  const netBefore = lines.map((line) => {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) throw new AppError("VALIDATION", "Quantities must be whole numbers above zero");
    if (!Number.isInteger(line.unitPrice) || line.unitPrice < 0) throw new AppError("VALIDATION", "Invalid price");
    if (!Number.isInteger(line.discount) || line.discount < 0) throw new AppError("VALIDATION", "Discounts cannot be negative");
    const gross = line.quantity * line.unitPrice;
    if (line.discount > gross) throw new AppError("VALIDATION", "A line discount is larger than the line value");
    return gross - line.discount;
  });
  const sumNet = netBefore.reduce((a, b) => a + b, 0);
  if (!Number.isInteger(cartDiscount) || cartDiscount < 0) throw new AppError("VALIDATION", "Discounts cannot be negative");
  if (cartDiscount > sumNet) throw new AppError("VALIDATION", "The discount is larger than the sale value");
  const shares = allocateProRata(cartDiscount, netBefore);

  const priced = lines.map((line, i) => {
    const gross = line.quantity * line.unitPrice;
    const totalDiscount = line.discount + shares[i];
    const taxable = gross - totalDiscount;
    const tax = applyBps(taxable, taxRateBps);
    return { ...line, gross, totalDiscount, tax, lineTotal: taxable + tax };
  });
  const subtotal = priced.reduce((s, l) => s + l.gross, 0);
  const discountTotal = priced.reduce((s, l) => s + l.totalDiscount, 0);
  const taxTotal = priced.reduce((s, l) => s + l.tax, 0);
  return { lines: priced, subtotal, discountTotal, taxTotal, total: subtotal - discountTotal + taxTotal };
}

export interface TenderInput {
  method: PaymentMethod;
  amount: number;
  externalReference?: string | null;
}

/** Applies tendered amounts to the total: excess is only allowed as cash and is returned as change. */
export function settleTenders(total: number, tenders: TenderInput[]): { recorded: TenderInput[]; paid: number; change: number } {
  for (const t of tenders) {
    if (!Number.isInteger(t.amount) || t.amount < 0) throw new AppError("VALIDATION", "Payment amounts cannot be negative");
  }
  const tendered = tenders.reduce((s, t) => s + t.amount, 0);
  const change = Math.max(tendered - total, 0);
  const cash = tenders.filter((t) => t.method === "CASH").reduce((s, t) => s + t.amount, 0);
  if (change > cash) {
    throw new AppError("VALIDATION", "Only cash can be over-tendered; reduce the mobile money/card/bank amounts to the sale total");
  }
  let changeLeft = change;
  const recorded = tenders
    .map((t) => {
      if (t.method !== "CASH" || changeLeft === 0) return t;
      const reduce = Math.min(changeLeft, t.amount);
      changeLeft -= reduce;
      return { ...t, amount: t.amount - reduce };
    })
    .filter((t) => t.amount > 0);
  return { recorded, paid: tendered - change, change };
}

