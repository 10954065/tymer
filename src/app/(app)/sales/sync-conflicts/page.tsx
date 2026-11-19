import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { Money } from "@/components/app/money";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/dates";
import { requirePagePermission } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { listSyncConflicts, type OfflineSalePayload } from "@/server/services/sync";
import { ConflictActions } from "./conflict-actions";

export const metadata: Metadata = { title: "Offline sale conflicts" };

const REASONS: Record<string, string> = {
  INSUFFICIENT_STOCK: "Not enough stock on the server",
  PRICE_CHANGED: "Prices changed while offline",
  VALIDATION: "Failed a business rule",
  MISSING_DATA: "Product or customer missing",
};

export default async function SyncConflictsPage({ searchParams }: PageProps<"/sales/sync-conflicts">) {
  await requirePagePermission("sync:review");
  const showAll = (await searchParams).all === "1";
  const rows = await listSyncConflicts(getDb(), showAll ? "ALL" : "PENDING");

  return (
    <>
      <PageHeader eyebrow="Sales" title="Offline sale conflicts"
        description="Sales made offline that the server could not record automatically. They are never deleted — record them as made, or dismiss them with a note."
        actions={<Link href={showAll ? "/sales/sync-conflicts" : "/sales/sync-conflicts?all=1"} className="text-sm underline">{showAll ? "Show pending only" : "Show resolved too"}</Link>} />
      {rows.length === 0 ? <EmptyState icon={CheckCircle2} title="No conflicts" description="Every offline sale has synced." /> : (
        <div className="grid gap-4">
          {rows.map(({ conflict, submittedByName }) => {
            const sale = conflict.payload as OfflineSalePayload & { items: (OfflineSalePayload["items"][number] & { name?: string })[] };
            const total = sale.items.reduce((s, i) => s + i.quantity * i.unitPrice - i.discount, 0) - sale.cartDiscount;
            return (
              <Card key={conflict.id} className="surface-elevated">
                <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">{REASONS[conflict.reason] ?? conflict.reason} <Badge variant="outline" className="ml-2">{conflict.status}</Badge></CardTitle>
                  <span className="text-sm text-muted-foreground">Made {formatDateTime(sale.clientCreatedAt)} by {submittedByName ?? "unknown"} · device {conflict.deviceId?.slice(0, 8)}</span>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <ul className="divide-y rounded-lg border">
                    {sale.items.map((i) => (
                      <li key={i.productId} className="flex justify-between px-3 py-2"><span>{i.name ?? i.productId} × {i.quantity}</span><Money value={i.quantity * i.unitPrice - i.discount} /></li>
                    ))}
                  </ul>
                  <p>Total <Money value={total} className="font-semibold" /> · paid {sale.payments.map((p) => `${p.method} ${(p.amount / 100).toFixed(2)}`).join(", ") || "nothing"}</p>
                  {conflict.details != null && <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs">{JSON.stringify(conflict.details, null, 1)}</pre>}
                  {conflict.status === "PENDING" ? <ConflictActions conflictId={conflict.id} /> : (
                    <p className="text-muted-foreground">Resolved {formatDateTime(conflict.resolvedAt)}: {conflict.resolutionNote}{conflict.saleId && <> · <Link href={`/sales/${conflict.saleId}`} className="underline">view sale</Link></>}</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
