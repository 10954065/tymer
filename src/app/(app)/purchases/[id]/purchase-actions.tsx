"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Ban, PackageCheck, Undo2, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { MoneyField, SelectField, TextField } from "@/components/app/form-fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { useServerAction } from "@/hooks/use-server-action";
import { toMoneyInput } from "@/lib/money";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/lib/validation/common";
import { reverseSchema, supplierPaymentSchema } from "@/lib/validation/purchases";
import {
  cancelPurchaseAction,
  receivePurchaseAction,
  recordSupplierPaymentAction,
  reverseSupplierPaymentAction,
} from "@/server/actions/purchases";

const methodOptions = PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }));

export function PurchaseActions(props: { id: string; status: string; outstanding: number; canManage: boolean; canPay: boolean }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"pay" | "cancel" | null>(null);
  const receive = useServerAction(receivePurchaseAction, { successMessage: "Stock received", onSuccess: () => router.refresh() });
  const isDraft = props.status === "DRAFT";
  return (
    <>
      {props.canManage && isDraft && (
        <Button disabled={receive.isPending} onClick={() => receive.run(props.id)}>
          <PackageCheck aria-hidden /> {receive.isPending ? "Receiving…" : "Mark goods received"}
        </Button>
      )}
      {props.canPay && props.status !== "CANCELLED" && props.outstanding > 0 && (
        <Button variant="outline" onClick={() => setDialog("pay")}><Wallet aria-hidden /> Record payment</Button>
      )}
      {props.canManage && isDraft && (
        <Button variant="ghost" onClick={() => setDialog("cancel")}><Ban aria-hidden /> Cancel</Button>
      )}
      {dialog === "pay" && <PayDialog purchaseId={props.id} outstanding={props.outstanding} onClose={() => setDialog(null)} />}
      {dialog === "cancel" && <CancelDialog purchaseId={props.id} onClose={() => setDialog(null)} />}
    </>
  );
}

function PayDialog({ purchaseId, outstanding, onClose }: { purchaseId: string; outstanding: number; onClose: () => void }) {
  const router = useRouter();
  const form = useForm<z.input<typeof supplierPaymentSchema>>({
    resolver: zodResolver(supplierPaymentSchema),
    defaultValues: { purchaseId, amount: toMoneyInput(outstanding), method: "CASH", externalReference: "", notes: "" },
  });
  const { run, isPending } = useServerAction(recordSupplierPaymentAction, {
    successMessage: "Payment recorded",
    setError: form.setError,
    onSuccess: () => {
      onClose();
      router.refresh();
    },
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pay supplier</DialogTitle>
          <DialogDescription>Supplier payments reduce cash but are not operating expenses.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((v) => run(v))} noValidate>
          <FieldGroup>
            <MoneyField control={form.control} name="amount" label="Amount (GH₵)" />
            <SelectField control={form.control} name="method" label="Method" options={methodOptions} />
            <TextField control={form.control} name="externalReference" label="Transaction reference (optional)" />
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Record payment"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({ purchaseId, onClose }: { purchaseId: string; onClose: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const { run, isPending } = useServerAction(cancelPurchaseAction, {
    successMessage: "Purchase cancelled",
    onSuccess: () => {
      onClose();
      router.refresh();
    },
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel this purchase?</DialogTitle>
          <DialogDescription>The record is kept for history. Stock is not affected because it was never received.</DialogDescription>
        </DialogHeader>
        <label className="text-sm font-medium" htmlFor="cancel-reason">Reason</label>
        <input id="cancel-reason" className="h-9 rounded-md border bg-transparent px-3 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Keep</Button>
          <Button variant="destructive" disabled={isPending || reason.trim().length < 3} onClick={() => run({ id: purchaseId, reason })}>Cancel purchase</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReverseSupplierPaymentButton({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const form = useForm<z.input<typeof reverseSchema>>({ resolver: zodResolver(reverseSchema), defaultValues: { paymentId, reason: "" } });
  const { run, isPending } = useServerAction(reverseSupplierPaymentAction, {
    successMessage: "Payment reversed",
    setError: form.setError,
    onSuccess: () => {
      setOpen(false);
      router.refresh();
    },
  });
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}><Undo2 aria-hidden /> Reverse</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reverse this payment?</DialogTitle>
            <DialogDescription>An equal negative entry is added. The original payment stays in the ledger.</DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit((v) => run(v))} noValidate>
            <TextField control={form.control} name="reason" label="Reason" />
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Keep</Button>
              <Button type="submit" variant="destructive" disabled={isPending}>Reverse payment</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
