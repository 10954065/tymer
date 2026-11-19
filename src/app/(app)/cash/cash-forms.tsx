"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney, toMoneyInput, tryParseMoney } from "@/lib/money";
import { closeCashAction, openCashAction } from "@/server/actions/expenses";

export function OpenCashForm({ businessDate, suggested }: { businessDate: string; suggested: number }) {
  const router = useRouter();
  const [amount, setAmount] = useState(toMoneyInput(suggested));
  const [notes, setNotes] = useState("");
  const [isPending, start] = useTransition();
  return (
    <form className="grid gap-3 sm:max-w-sm" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await openCashAction({ businessDate, openingBalance: amount, notes });
        if (r.ok) { toast.success("Cash drawer opened"); router.refresh(); } else toast.error(r.error);
      });
    }}>
      <div className="grid gap-1.5"><Label htmlFor="open-amount">Opening cash in drawer (GH₵)</Label><Input id="open-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      <div className="grid gap-1.5"><Label htmlFor="open-notes">Notes</Label><Input id="open-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      <Button type="submit" disabled={isPending || tryParseMoney(amount) === null}>Open cash drawer</Button>
    </form>
  );
}

export function CloseCashForm({ sessionId, expected }: { sessionId: string; expected: number }) {
  const router = useRouter();
  const [counted, setCounted] = useState("");
  const [explanation, setExplanation] = useState("");
  const [isPending, start] = useTransition();
  const parsed = tryParseMoney(counted);
  const difference = parsed === null ? null : parsed - expected;
  return (
    <form className="grid gap-3" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await closeCashAction({ sessionId, actualClosing: counted, explanation });
        if (r.ok) { toast.success(r.data.difference === 0 ? "Day closed — cash balanced" : `Day closed with a difference of ${formatMoney(r.data.difference)}`); router.refresh(); } else toast.error(r.error);
      });
    }}>
      <div className="grid gap-1.5"><Label htmlFor="counted">Cash counted in drawer (GH₵)</Label><Input id="counted" inputMode="decimal" className="text-lg tabular-nums" value={counted} onChange={(e) => setCounted(e.target.value)} /></div>
      {difference !== null && (
        <p className={difference === 0 ? "text-sm text-success" : "text-sm font-medium text-destructive"}>
          {difference === 0 ? "Cash balances exactly." : difference < 0 ? `Shortage of ${formatMoney(-difference)}` : `Excess of ${formatMoney(difference)}`}
        </p>
      )}
      {difference !== null && difference !== 0 && (
        <div className="grid gap-1.5"><Label htmlFor="explain">Explanation (required)</Label><Textarea id="explain" rows={2} value={explanation} onChange={(e) => setExplanation(e.target.value)} /></div>
      )}
      <Button type="submit" disabled={isPending || parsed === null}>Close the day</Button>
    </form>
  );
}
