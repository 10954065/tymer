"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney, toMoneyInput, tryParseMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/validation/common";

interface PaymentDialogProps {
  title: string;
  description?: string;
  maxAmount: number;
  confirmLabel?: string;
  onSubmit: (values: { amount: string; method: PaymentMethod; externalReference: string; notes: string }) => Promise<boolean>;
  onClose: () => void;
}

/** Records one payment (amount, method, optional transaction reference). Resolves true when saved. */
export function PaymentDialog({ title, description, maxAmount, confirmLabel = "Record payment", onSubmit, onClose }: PaymentDialogProps) {
  const [amount, setAmount] = useState(toMoneyInput(maxAmount));
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [reference, setReference] = useState("");
  const [isPending, start] = useTransition();
  const parsed = tryParseMoney(amount);
  const invalid = parsed === null || parsed <= 0 || parsed > maxAmount;
  return (
    <Dialog open onOpenChange={(v) => !v && !isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description ?? `Up to ${formatMoney(maxAmount)}.`}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="flex flex-wrap gap-1.5">
            {PAYMENT_METHODS.map((m) => (
              <button key={m} type="button" onClick={() => setMethod(m)}
                className={cn("rounded-md border px-2 py-1 text-xs", method === m ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
                {PAYMENT_METHOD_LABELS[m]}
              </button>
            ))}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pd-amount">Amount (GH₵)</Label>
            <Input id="pd-amount" inputMode="decimal" className="tabular-nums" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={invalid} />
          </div>
          {method !== "CASH" && (
            <div className="grid gap-1.5">
              <Label htmlFor="pd-ref">Transaction reference</Label>
              <Input id="pd-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={invalid || isPending} onClick={() => start(async () => { if (await onSubmit({ amount, method, externalReference: reference, notes: "" })) onClose(); })}>
            {isPending ? "Saving…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ReasonDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: (reason: string) => Promise<boolean>;
  onClose: () => void;
}

/** Confirmation that requires a written reason (voids, reversals, cancellations). */
export function ReasonDialog({ title, description, confirmLabel, destructive, onConfirm, onClose }: ReasonDialogProps) {
  const [reason, setReason] = useState("");
  const [isPending, start] = useTransition();
  return (
    <Dialog open onOpenChange={(v) => !v && !isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="rd-reason">Reason</Label>
          <Textarea id="rd-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Back</Button>
          <Button variant={destructive ? "destructive" : "default"} disabled={reason.trim().length < 3 || isPending}
            onClick={() => start(async () => { if (await onConfirm(reason.trim())) onClose(); })}>
            {isPending ? "Saving…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
