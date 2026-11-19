"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { priceCart } from "@/lib/pricing";
import { cacheCatalog, loadCachedCatalog, queueSale } from "@/lib/offline/outbox";
import { checkoutAction } from "@/server/actions/sales";
import type { SubmitResult } from "./checkout-dialog";
import { PosTerminal, type PosProduct, type SaleSubmission } from "./pos-terminal";

interface PosClientProps {
  products: PosProduct[];
  categories: { id: string; name: string }[];
  taxRateBps: number;
  taxLabel: string;
  allowNegativeStock: boolean;
  canCreateCustomer: boolean;
}

/**
 * Online: sales go straight to the server. Offline (or if the network drops mid-sale): the sale is queued on this
 * device with the same idempotency key and synced later. The catalogue is cached for offline use on every visit.
 */
export function PosClient(props: PosClientProps) {
  const router = useRouter();
  const saleKey = useRef<string>(crypto.randomUUID());
  const [products, setProducts] = useState(props.products);

  useEffect(() => {
    if (navigator.onLine) {
      void cacheCatalog(props.products, { taxRateBps: props.taxRateBps, taxLabel: props.taxLabel }).catch(() => undefined);
      return;
    }
    // Offline: the cached catalogue includes stock already sold on this device.
    void loadCachedCatalog().then((cached) => cached.length && setProducts(cached));
  }, [props.products, props.taxRateBps, props.taxLabel]);

  async function queue(sale: SaleSubmission): Promise<SubmitResult> {
    const cart = priceCart(
      sale.lines.map((l) => ({ productId: l.product.id, quantity: l.quantity, unitPrice: l.product.sellingPrice, discount: l.discount })),
      sale.cartDiscount,
      props.taxRateBps,
    );
    const paid = sale.payments.reduce((s, p) => s + p.amount, 0);
    await queueSale(
      {
        idempotencyKey: saleKey.current,
        customerId: sale.customer?.id ?? null,
        items: sale.lines.map((l) => ({ productId: l.product.id, quantity: l.quantity, discount: l.discount, unitPrice: l.product.sellingPrice, name: l.product.name })),
        cartDiscount: sale.cartDiscount,
        payments: sale.payments,
        notes: null,
        clientCreatedAt: new Date().toISOString(),
      },
      cart.total,
    );
    setProducts((prev) => prev.map((p) => {
      const line = sale.lines.find((l) => l.product.id === p.id);
      return line ? { ...p, quantity: p.quantity - line.quantity } : p;
    }));
    saleKey.current = crypto.randomUUID();
    return { ok: true, queued: true, change: Math.max(paid - cart.total, 0), balance: Math.max(cart.total - paid, 0) };
  }

  async function submitSale(sale: SaleSubmission): Promise<SubmitResult> {
    if (!navigator.onLine) return queue(sale);
    let result: Awaited<ReturnType<typeof checkoutAction>> | null = null;
    try {
      result = await checkoutAction({
        idempotencyKey: saleKey.current,
        customerId: sale.customer?.id ?? null,
        items: sale.lines.map((l) => ({ productId: l.product.id, quantity: l.quantity, discount: l.discount })),
        cartDiscount: sale.cartDiscount,
        payments: sale.payments,
      });
    } catch {
      // The request may or may not have reached the server; queuing with the same key is safe either way.
      return queue(sale);
    }
    if (!result.ok) return { ok: false, error: result.error };
    saleKey.current = crypto.randomUUID();
    router.refresh();
    return { ok: true, saleId: result.data.saleId, saleNumber: result.data.saleNumber, change: result.data.change, balance: result.data.balance };
  }

  return <PosTerminal {...props} products={products} submitSale={submitSale} />;
}
