"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";
import { checkoutAction } from "@/server/actions/sales";
import { PosTerminal, type PosProduct, type SaleSubmission } from "./pos-terminal";
import type { SubmitResult } from "./checkout-dialog";

interface PosClientProps {
  products: PosProduct[];
  categories: { id: string; name: string }[];
  taxRateBps: number;
  taxLabel: string;
  allowNegativeStock: boolean;
  canCreateCustomer: boolean;
}

export function PosClient(props: PosClientProps) {
  const router = useRouter();
  // One idempotency key per sale: retries (double taps, slow network) reuse it, so a sale is never recorded twice.
  const saleKey = useRef<string>(crypto.randomUUID());

  async function submitSale(sale: SaleSubmission): Promise<SubmitResult> {
    const result = await checkoutAction({
      idempotencyKey: saleKey.current,
      customerId: sale.customer?.id ?? null,
      items: sale.lines.map((l) => ({ productId: l.product.id, quantity: l.quantity, discount: l.discount })),
      cartDiscount: sale.cartDiscount,
      payments: sale.payments,
    }).catch(() => null);
    if (!result) return { ok: false, error: "Could not reach the server. Check the connection and try again." };
    if (!result.ok) return { ok: false, error: result.error };
    saleKey.current = crypto.randomUUID();
    router.refresh();
    return { ok: true, saleId: result.data.saleId, saleNumber: result.data.saleNumber, change: result.data.change, balance: result.data.balance };
  }

  return <PosTerminal {...props} submitSale={submitSale} />;
}
