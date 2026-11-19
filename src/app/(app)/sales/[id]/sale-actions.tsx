"use client";

import { Ban, Printer, RotateCcw, Undo2, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { PaymentDialog, ReasonDialog } from "@/components/app/money-dialogs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney, toMoneyInput, tryParseMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/validation/common";
import { recordSalePaymentAction, returnSaleAction, reversePaymentAction, voidSaleAction } from "@/server/actions/sales";

interface ReturnableItem {
  id: string;
  productName: string;
  remaining: number;
  unitValue: number;
}

interface SaleActionsProps {
  saleId: string;
  status: string;
  balance: number;
  paid: number;
  hasReturns: boolean;
  items: ReturnableItem[];
  can: { pay: boolean; void: boolean; return: boolean };
}

export function SaleActions({ saleId, status, balance, paid, hasReturns, items, can }: SaleActionsProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"pay" | "void" | "return" | null>(null);
  const completed = status === "COMPLETED";
  const done = () => router.refresh();

  return (
    <>
      <Button asChild variant="outline"><Link href={`/receipts/${saleId}?print=1`} target="_blank"><Printer aria-hidden /> Receipt</Link></Button>
      {completed && can.pay && balance > 0 && <Button onClick={() => setDialog("pay")}><Wallet aria-hidden /> Record payment</Button>}
      {completed && can.return && items.some((i) => i.remaining > 0) && <Button variant="outline" onClick={() => setDialog("return")}><RotateCcw aria-hidden /> Return items</Button>}
      {completed && can.void && !hasReturns && <Button variant="ghost" onClick={() => setDialog("void")}><Ban aria-hidden /> Void sale</Button>}

      {dialog === "pay" && (
        <PaymentDialog
          title="Record balance payment"
          maxAmount={balance}
          onClose={() => setDialog(null)}
          onSubmit={async (v) => {
            const r = await recordSalePaymentAction({ saleId, ...v });
            if (!r.ok) toast.error(r.error);
            else { toast.success("Payment recorded"); done(); }
            return r.ok;
          }}
        />
      )}
      {dialog === "void" && (
        <ReasonDialog
          title="Void this sale?"
          description="Stock is put back and every payment is reversed. The sale stays in history marked as voided."
          confirmLabel="Void sale"
          destructive
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            const r = await voidSaleAction({ saleId, reason });
            if (!r.ok) toast.error(r.error);
            else { toast.success("Sale voided"); done(); }
            return r.ok;
          }}
        />
      )}
      {dialog === "return" && <ReturnDialog saleId={saleId} items={items} paid={paid} onClose={() => setDialog(null)} onDone={done} />}
    </>
  );
}

function ReturnDialog({ saleId, items, paid, onClose, onDone }: { saleId: string; items: ReturnableItem[]; paid: number; onClose: () => void; onDone: () => void }) {
  const key = useRef(crypto.randomUUID());
  const [qty, setQty] = useState<Record<string, number>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [isPending, start] = useTransition();
  const selected = items.filter((i) => (qty[i.id] ?? 0) > 0);
  const estimate = selected.reduce((s, i) => s + i.unitValue * (qty[i.id] ?? 0), 0);

  function submit() {
    start(async () => {
      const refund = tryParseMoney(refundAmount) ?? 0;
      const r = await returnSaleAction({
        saleId,
        idempotencyKey: key.current,
        reason,
        items: selected.map((i) => ({ saleItemId: i.id, quantity: qty[i.id], restock: restock[i.id] ?? true })),
        refund: refund > 0 ? { method, amount: refund } : null,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`${r.data.returnNumber} recorded${r.data.refunded ? ` · refunded ${formatMoney(r.data.refunded)}` : ""}`);
      onClose();
      onDone();
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && !isPending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Return items</DialogTitle>
          <DialogDescription>Tick “Back in stock” only for goods physically accepted in sellable condition.</DialogDescription>
        </DialogHeader>
        <ul className="max-h-64 space-y-2 overflow-y-auto">
          {items.filter((i) => i.remaining > 0).map((i) => (
            <li key={i.id} className="grid grid-cols-[1fr_70px] items-center gap-2 rounded-lg border p-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-medium">{i.productName}</span>
                <span className="text-xs text-muted-foreground">{i.remaining} returnable · ≈{formatMoney(i.unitValue)} each</span>
                <label className="mt-1 flex items-center gap-1.5 text-xs">
                  <Checkbox checked={restock[i.id] ?? true} onCheckedChange={(v) => setRestock((p) => ({ ...p, [i.id]: v === true }))} /> Back in stock
                </label>
              </span>
              <Input aria-label={`Quantity of ${i.productName} returned`} type="number" min={0} max={i.remaining} value={qty[i.id] ?? 0}
                onChange={(e) => setQty((p) => ({ ...p, [i.id]: Math.min(Math.max(Number(e.target.value) || 0, 0), i.remaining) }))} />
            </li>
          ))}
        </ul>
        <div className="grid gap-1.5">
          <Label htmlFor="ret-reason">Reason</Label>
          <Textarea id="ret-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="grid gap-1.5 rounded-lg bg-muted/50 p-3">
          <Label htmlFor="ret-refund">Refund to customer (optional, up to what was paid: {formatMoney(paid)})</Label>
          <div className="flex gap-2">
            <Input id="ret-refund" inputMode="decimal" placeholder={toMoneyInput(Math.min(estimate, paid))} value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} />
            <select aria-label="Refund method" className="rounded-md border bg-background px-2 text-sm" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className={cn(selected.length === 0 && "opacity-60")} disabled={selected.length === 0 || reason.trim().length < 3 || isPending} onClick={submit}>
            {isPending ? "Saving…" : `Record return (≈${formatMoney(estimate)})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReversePaymentButton({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}><Undo2 aria-hidden /> Reverse</Button>
      {open && (
        <ReasonDialog
          title="Reverse this payment?"
          description="Use this only for mistakes (e.g. a transfer that never arrived). An equal negative entry is added; nothing is deleted."
          confirmLabel="Reverse payment"
          destructive
          onClose={() => setOpen(false)}
          onConfirm={async (reason) => {
            const r = await reversePaymentAction({ paymentId, reason });
            if (!r.ok) toast.error(r.error);
            else { toast.success("Payment reversed"); router.refresh(); }
            return r.ok;
          }}
        />
      )}
    </>
  );
}
