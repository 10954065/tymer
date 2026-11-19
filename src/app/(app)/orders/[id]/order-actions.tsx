"use client";

import { Ban, CheckCircle2, Hammer, PackageCheck, Pencil, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PaymentDialog, ReasonDialog } from "@/components/app/money-dialogs";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/errors";
import { cancelOrderAction, completeOrderAction, recordOrderPaymentAction, setOrderStatusAction } from "@/server/actions/orders";

interface OrderActionsProps {
  orderId: string;
  status: string;
  outstanding: number;
  paid: number;
  canManage: boolean;
  canPay: boolean;
}

export function OrderActions({ orderId, status, outstanding, paid, canManage, canPay }: OrderActionsProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"pay" | "cancel" | null>(null);
  const [isPending, start] = useTransition();
  const open = ["NEW", "DEPOSIT_PAID", "IN_PROGRESS", "READY"].includes(status);
  const handle = (promise: Promise<ActionResult<unknown>>, message: string) =>
    start(async () => {
      const r = await promise;
      if (r.ok) { toast.success(message); router.refresh(); } else toast.error(r.error);
    });

  return (
    <>
      {canPay && status !== "CANCELLED" && outstanding > 0 && <Button onClick={() => setDialog("pay")}><Wallet aria-hidden /> {paid === 0 ? "Take deposit" : "Record payment"}</Button>}
      {canManage && open && status !== "IN_PROGRESS" && status !== "READY" && (
        <Button variant="outline" disabled={isPending} onClick={() => handle(setOrderStatusAction({ orderId, status: "IN_PROGRESS" }), "Marked in progress")}><Hammer aria-hidden /> Start work</Button>
      )}
      {canManage && status === "IN_PROGRESS" && (
        <Button variant="outline" disabled={isPending} onClick={() => handle(setOrderStatusAction({ orderId, status: "READY" }), "Marked ready")}><PackageCheck aria-hidden /> Mark ready</Button>
      )}
      {canManage && open && (
        <Button variant="outline" disabled={isPending} onClick={() => handle(completeOrderAction(orderId), "Order completed — revenue recognised")}><CheckCircle2 aria-hidden /> Complete</Button>
      )}
      {canManage && open && <Button asChild variant="ghost"><Link href={`/orders/new?edit=${orderId}`}><Pencil aria-hidden /> Edit</Link></Button>}
      {canManage && open && <Button variant="ghost" onClick={() => setDialog("cancel")}><Ban aria-hidden /> Cancel</Button>}

      {dialog === "pay" && (
        <PaymentDialog
          title={paid === 0 ? "Take a deposit" : "Record a payment"}
          maxAmount={outstanding}
          onClose={() => setDialog(null)}
          onSubmit={async (v) => {
            const r = await recordOrderPaymentAction({ orderId, ...v });
            if (r.ok) { toast.success("Payment recorded"); router.refresh(); } else toast.error(r.error);
            return r.ok;
          }}
        />
      )}
      {dialog === "cancel" && (
        <ReasonDialog
          title="Cancel this order?"
          description={paid > 0 ? `The customer has paid ${(paid / 100).toFixed(2)} cedis; it will be refunded in cash. Record a different refund from the Payments page if needed.` : "No payments have been made."}
          confirmLabel="Cancel order"
          destructive
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            const r = await cancelOrderAction({ orderId, reason, refund: paid > 0 ? { method: "CASH", amount: paid } : null });
            if (r.ok) { toast.success("Order cancelled"); router.refresh(); } else toast.error(r.error);
            return r.ok;
          }}
        />
      )}
    </>
  );
}
