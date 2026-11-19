"use client";

import { CheckCircle2, Loader2, Printer, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatMoney, toMoneyInput, tryParseMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/validation/common";

export interface SubmitResult {
  ok: boolean;
  queued?: boolean;
  saleId?: string;
  saleNumber?: string;
  change?: number;
  balance?: number;
  error?: string;
}

interface Tender {
  method: PaymentMethod;
  amount: string;
  reference: string;
}

interface CheckoutDialogProps {
  total: number;
  hasCustomer: boolean;
  onSubmit: (tenders: { method: PaymentMethod; amount: number; externalReference: string | null }[]) => Promise<SubmitResult>;
  onDone: () => void;
  onClose: () => void;
}

export function CheckoutDialog({ total, hasCustomer, onSubmit, onDone, onClose }: CheckoutDialogProps) {
  const [tenders, setTenders] = useState<Tender[]>([{ method: "CASH", amount: toMoneyInput(total), reference: "" }]);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [isPending, start] = useTransition();
  const tendered = tenders.reduce((s, t) => s + (tryParseMoney(t.amount) ?? 0), 0);
  const remaining = total - tendered;
  const invalid = tenders.some((t) => t.amount !== "" && tryParseMoney(t.amount) === null);
  const shortWithoutCustomer = remaining > 0 && !hasCustomer;

  const update = (i: number, patch: Partial<Tender>) => setTenders((prev) => prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));

  function confirm() {
    start(async () => {
      const outcome = await onSubmit(
        tenders
          .map((t) => ({ method: t.method, amount: tryParseMoney(t.amount) ?? 0, externalReference: t.reference || null }))
          .filter((t) => t.amount > 0),
      );
      if (outcome.ok) setResult(outcome);
      else toast.error(outcome.error ?? "The sale could not be completed");
    });
  }

  if (result) {
    return (
      <Dialog open onOpenChange={(v) => !v && onDone()}>
        <DialogContent className="sm:max-w-sm">
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <CheckCircle2 className="size-12 text-success" aria-hidden />
            <h2 className="font-heading text-2xl font-semibold">{result.queued ? "Saved offline" : "Sale complete"}</h2>
            {result.saleNumber && <p className="text-sm text-muted-foreground">{result.saleNumber}</p>}
            {result.queued && <p className="text-sm text-muted-foreground">It will sync automatically when the connection returns.</p>}
            {!!result.change && result.change > 0 && (
              <p className="mt-2 rounded-lg bg-warning/20 px-4 py-2 text-lg font-semibold">Change due: {formatMoney(result.change)}</p>
            )}
            {!!result.balance && result.balance > 0 && <p className="text-sm">Balance owed: {formatMoney(result.balance)}</p>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {result.saleId ? (
              <Button asChild variant="outline"><Link href={`/receipts/${result.saleId}`} target="_blank"><Printer aria-hidden /> Receipt</Link></Button>
            ) : (
              <span />
            )}
            <Button onClick={onDone} autoFocus>New sale</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(v) => !v && !isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Take payment</DialogTitle>
          <DialogDescription>Total due <span className="font-semibold text-foreground">{formatMoney(total)}</span></DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {tenders.map((tender, i) => (
            <div key={i} className="space-y-2 rounded-lg border p-3">
              <div className="flex flex-wrap gap-1.5">
                {PAYMENT_METHODS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => update(i, { method: m })}
                    className={cn("rounded-md border px-2 py-1 text-xs", tender.method === m ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
                  >
                    {PAYMENT_METHOD_LABELS[m]}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <Input aria-label="Amount" inputMode="decimal" className="text-lg tabular-nums" value={tender.amount} onChange={(e) => update(i, { amount: e.target.value })} />
                {tenders.length > 1 && (
                  <Button variant="ghost" size="icon" aria-label="Remove payment" onClick={() => setTenders((prev) => prev.filter((_, idx) => idx !== i))}><Trash2 aria-hidden /></Button>
                )}
              </div>
              {tender.method !== "CASH" && (
                <Input aria-label="Transaction reference" placeholder="Transaction ID (optional)" value={tender.reference} onChange={(e) => update(i, { reference: e.target.value })} />
              )}
            </div>
          ))}
          {remaining > 0 && (
            <Button variant="outline" size="sm" onClick={() => setTenders((prev) => [...prev, { method: "MTN_MOMO", amount: toMoneyInput(remaining), reference: "" }])}>
              Split payment ({formatMoney(remaining)} left)
            </Button>
          )}
          <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm">
            <span>{remaining > 0 ? "Still owed" : "Change"}</span>
            <span className="font-semibold tabular-nums">{formatMoney(Math.abs(remaining))}</span>
          </div>
          {shortWithoutCustomer && <p className="text-xs text-destructive">Add a customer to the sale to leave a balance unpaid.</p>}
          <Button size="lg" className="h-11 w-full text-base" disabled={isPending || invalid || shortWithoutCustomer} onClick={confirm}>
            {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {isPending ? "Completing…" : remaining > 0 ? `Record part payment` : "Complete sale"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
