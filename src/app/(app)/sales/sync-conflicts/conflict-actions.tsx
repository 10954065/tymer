"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ReasonDialog } from "@/components/app/money-dialogs";
import { Button } from "@/components/ui/button";
import { resolveSyncConflictAction } from "@/server/actions/sync";

export function ConflictActions({ conflictId }: { conflictId: string }) {
  const router = useRouter();
  const [decision, setDecision] = useState<"record" | "dismiss" | null>(null);
  return (
    <div className="flex gap-2">
      <Button size="sm" onClick={() => setDecision("record")}>Record sale as made</Button>
      <Button size="sm" variant="outline" onClick={() => setDecision("dismiss")}>Dismiss</Button>
      {decision && (
        <ReasonDialog
          title={decision === "record" ? "Record this offline sale?" : "Dismiss this offline sale?"}
          description={decision === "record"
            ? "The sale is booked at the prices used offline. If stock is short, quantities may go below zero — do a stock count afterwards."
            : "The sale will not be recorded. The conflict stays in the history with your note."}
          confirmLabel={decision === "record" ? "Record sale" : "Dismiss"}
          destructive={decision === "dismiss"}
          onClose={() => setDecision(null)}
          onConfirm={async (note) => {
            const r = await resolveSyncConflictAction({ conflictId, decision, note });
            if (r.ok) { toast.success(decision === "record" ? "Sale recorded" : "Conflict dismissed"); router.refresh(); } else toast.error(r.error);
            return r.ok;
          }}
        />
      )}
    </div>
  );
}
