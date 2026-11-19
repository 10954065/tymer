"use client";

import { Minus, Package, Plus, ScanLine, Search, ShoppingCart, Trash2, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatMoney, tryParseMoney } from "@/lib/money";
import { priceCart } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import type { PaymentMethod } from "@/lib/validation/common";
import { CheckoutDialog, type SubmitResult } from "./checkout-dialog";
import { CustomerPicker, type PickedCustomer } from "./customer-picker";

export interface PosProduct {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  sellingPrice: number;
  quantity: number;
  categoryId: string | null;
  imageKey: string | null;
}

interface CartLine {
  product: PosProduct;
  quantity: number;
  discount: string;
}

export interface SaleSubmission {
  customer: PickedCustomer | null;
  lines: { product: PosProduct; quantity: number; discount: number }[];
  cartDiscount: number;
  payments: { method: PaymentMethod; amount: number; externalReference: string | null }[];
}

interface PosTerminalProps {
  products: PosProduct[];
  categories: { id: string; name: string }[];
  taxRateBps: number;
  taxLabel: string;
  allowNegativeStock: boolean;
  canCreateCustomer: boolean;
  /** Sends the sale (online, or queued offline in Phase 10). */
  submitSale: (sale: SaleSubmission) => Promise<SubmitResult>;
  headerSlot?: React.ReactNode;
}

export function PosTerminal({ products, categories, taxRateBps, taxLabel, allowNegativeStock, canCreateCustomer, submitSale, headerSlot }: PosTerminalProps) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [cartDiscount, setCartDiscount] = useState("");
  const [checkingOut, setCheckingOut] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products
      .filter((p) => (!category || p.categoryId === category) && (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.barcode === q))
      .slice(0, 120);
  }, [products, search, category]);

  const priced = useMemo(() => {
    if (cart.length === 0) return null;
    try {
      return priceCart(
        cart.map((l) => ({ productId: l.product.id, quantity: l.quantity, unitPrice: l.product.sellingPrice, discount: tryParseMoney(l.discount) ?? 0 })),
        tryParseMoney(cartDiscount) ?? 0,
        taxRateBps,
      );
    } catch (error) {
      return error instanceof Error ? error.message : "Check the discounts";
    }
  }, [cart, cartDiscount, taxRateBps]);

  function add(product: PosProduct) {
    setCart((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      const nextQty = (existing?.quantity ?? 0) + 1;
      if (!allowNegativeStock && nextQty > product.quantity) {
        toast.warning(`Only ${product.quantity} × ${product.name} in stock`);
        return prev;
      }
      return existing ? prev.map((l) => (l.product.id === product.id ? { ...l, quantity: nextQty } : l)) : [...prev, { product, quantity: 1, discount: "" }];
    });
  }

  function setQty(productId: string, quantity: number) {
    setCart((prev) =>
      prev.flatMap((l) => {
        if (l.product.id !== productId) return [l];
        if (quantity <= 0) return [];
        if (!allowNegativeStock && quantity > l.product.quantity) {
          toast.warning(`Only ${l.product.quantity} in stock`);
          return [l];
        }
        return [{ ...l, quantity }];
      }),
    );
  }

  /** Barcode scanners type the code and press Enter: add an exact SKU/barcode match straight to the cart. */
  function handleSearchKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    const code = search.trim().toLowerCase();
    const match = products.find((p) => p.barcode?.toLowerCase() === code || p.sku.toLowerCase() === code) ?? (visible.length === 1 ? visible[0] : undefined);
    if (match) {
      add(match);
      setSearch("");
    } else if (code) {
      toast.error(`No product with code “${search.trim()}”`);
    }
  }

  function reset() {
    setCart([]);
    setCustomer(null);
    setCartDiscount("");
    setCheckingOut(false);
    setCartOpen(false);
    searchRef.current?.focus();
  }

  const total = typeof priced === "object" && priced ? priced.total : 0;
  const itemCount = cart.reduce((s, l) => s + l.quantity, 0);

  const cartPanel = (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b p-4">
        <CustomerPicker value={customer} onChange={setCustomer} canCreate={canCreateCustomer} />
      </div>
      <ul className="flex-1 divide-y overflow-y-auto px-4" aria-label="Cart">
        {cart.length === 0 && (
          <li className="flex h-full flex-col items-center justify-center gap-2 py-16 text-center text-sm text-muted-foreground">
            <ShoppingCart className="size-8 opacity-40" aria-hidden /> Tap a product or scan a barcode
          </li>
        )}
        {cart.map((line) => (
          <li key={line.product.id} className="py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{line.product.name}</p>
                <p className="text-xs text-muted-foreground tabular-nums">{formatMoney(line.product.sellingPrice)} each</p>
              </div>
              <p className="text-sm font-semibold tabular-nums">{formatMoney(line.quantity * line.product.sellingPrice)}</p>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div className="flex items-center rounded-lg border">
                <Button variant="ghost" size="icon-sm" aria-label="Decrease" onClick={() => setQty(line.product.id, line.quantity - 1)}><Minus aria-hidden /></Button>
                <span className="w-8 text-center text-sm tabular-nums" aria-live="polite">{line.quantity}</span>
                <Button variant="ghost" size="icon-sm" aria-label="Increase" onClick={() => setQty(line.product.id, line.quantity + 1)}><Plus aria-hidden /></Button>
              </div>
              <Input
                aria-label={`Discount on ${line.product.name}`}
                placeholder="Discount"
                inputMode="decimal"
                className="h-8 w-24 text-xs"
                value={line.discount}
                onChange={(e) => setCart((prev) => prev.map((l) => (l.product.id === line.product.id ? { ...l, discount: e.target.value } : l)))}
              />
              <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label={`Remove ${line.product.name}`} onClick={() => setQty(line.product.id, 0)}><Trash2 aria-hidden /></Button>
            </div>
          </li>
        ))}
      </ul>
      <div className="space-y-2 border-t bg-muted/30 p-4">
        {typeof priced === "string" && <p className="text-xs text-destructive">{priced}</p>}
        {typeof priced === "object" && priced && (
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd className="tabular-nums">{formatMoney(priced.subtotal)}</dd></div>
            {priced.discountTotal > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Discounts</dt><dd className="tabular-nums">−{formatMoney(priced.discountTotal)}</dd></div>}
            {priced.taxTotal > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">{taxLabel}</dt><dd className="tabular-nums">{formatMoney(priced.taxTotal)}</dd></div>}
          </dl>
        )}
        <div className="flex items-center gap-2">
          <Input aria-label="Cart discount" placeholder="Cart discount (GH₵)" inputMode="decimal" className="h-8 text-xs" value={cartDiscount} onChange={(e) => setCartDiscount(e.target.value)} />
          {cart.length > 0 && <Button variant="ghost" size="sm" onClick={reset}><X aria-hidden /> Clear</Button>}
        </div>
        <Button size="lg" className="h-12 w-full text-base" disabled={typeof priced !== "object" || !priced} onClick={() => setCheckingOut(true)}>
          Charge {formatMoney(total)}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="-mx-3 -my-5 grid h-[calc(100svh-3.5rem)] grid-cols-1 sm:-mx-6 sm:-my-7 lg:grid-cols-[1fr_380px]">
      <section className="flex min-h-0 flex-col" aria-label="Products">
        <div className="space-y-3 border-b bg-background/80 p-3 sm:p-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                ref={searchRef}
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleSearchKey}
                placeholder="Search or scan barcode / SKU"
                className="h-11 pl-9 text-base"
                aria-label="Search products or scan a barcode"
              />
              <ScanLine className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            </div>
            {headerSlot}
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Categories">
            {[{ id: null, name: "All" }, ...categories].map((c) => (
              <button
                key={c.id ?? "all"}
                role="tab"
                aria-selected={category === c.id}
                onClick={() => setCategory(c.id)}
                className={cn("shrink-0 rounded-full border px-3 py-1 text-xs font-medium", category === c.id ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
        <div className="grid flex-1 grid-cols-2 content-start gap-2 overflow-y-auto p-3 sm:grid-cols-3 sm:p-4 xl:grid-cols-4 2xl:grid-cols-5">
          {visible.length === 0 && <p className="col-span-full py-16 text-center text-sm text-muted-foreground">No products match.</p>}
          {visible.map((p) => (
            <button
              key={p.id}
              onClick={() => add(p)}
              className="group flex flex-col overflow-hidden rounded-xl border bg-card text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring active:translate-y-0"
            >
              <span className="grid aspect-[4/3] place-items-center bg-muted/60">
                {p.imageKey ? (
                  // eslint-disable-next-line @next/next/no-img-element -- authenticated, pre-compressed file route
                  <img src={`/api/files/${p.imageKey}`} alt="" loading="lazy" className="size-full object-cover" />
                ) : (
                  <Package className="size-6 text-muted-foreground/60" aria-hidden />
                )}
              </span>
              <span className="flex flex-1 flex-col gap-0.5 p-2.5">
                <span className="line-clamp-2 text-sm leading-tight font-medium">{p.name}</span>
                <span className="mt-auto flex items-baseline justify-between gap-1 pt-1">
                  <span className="text-sm font-semibold tabular-nums">{formatMoney(p.sellingPrice)}</span>
                  <span className={cn("text-[0.7rem] tabular-nums", p.quantity <= 2 ? "text-destructive" : "text-muted-foreground")}>{p.quantity} left</span>
                </span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <aside className="hidden min-h-0 border-l bg-card lg:block" aria-label="Current sale">{cartPanel}</aside>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card p-3 lg:hidden" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
        <Button size="lg" className="h-12 w-full justify-between text-base" onClick={() => setCartOpen(true)}>
          <span className="flex items-center gap-2"><ShoppingCart aria-hidden /> {itemCount} item{itemCount === 1 ? "" : "s"}</span>
          <span className="tabular-nums">{formatMoney(total)}</span>
        </Button>
      </div>
      <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent side="bottom" className="h-[88svh] p-0">
          <SheetHeader className="sr-only"><SheetTitle>Current sale</SheetTitle></SheetHeader>
          {cartPanel}
        </SheetContent>
      </Sheet>

      {checkingOut && typeof priced === "object" && priced && (
        <CheckoutDialog
          total={priced.total}
          hasCustomer={Boolean(customer)}
          onClose={() => setCheckingOut(false)}
          onDone={reset}
          onSubmit={(payments) =>
            submitSale({
              customer,
              lines: cart.map((l) => ({ product: l.product, quantity: l.quantity, discount: tryParseMoney(l.discount) ?? 0 })),
              cartDiscount: tryParseMoney(cartDiscount) ?? 0,
              payments,
            })
          }
        />
      )}
    </div>
  );
}

