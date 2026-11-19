import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Money } from "@/components/app/money";
import { PageHeader } from "@/components/app/page-header";
import { PurchaseStatusBadge } from "@/components/app/status-badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/validation/common";
import { requirePagePermission } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { getPurchase } from "@/server/services/purchases";
import { PurchaseActions, ReverseSupplierPaymentButton } from "./purchase-actions";

export const metadata: Metadata = { title: "Purchase" };

export default async function PurchasePage({ params }: PageProps<"/purchases/[id]">) {
  const session = await requirePagePermission("purchases:view");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const purchase = await getPurchase(getDb(), id).catch(() => null);
  if (!purchase) notFound();
  const canPay = can(session.user.role, "purchases:pay");

  return (
    <>
      <PageHeader
        eyebrow={`Purchase · ${formatDate(purchase.purchaseDate)}`}
        title={purchase.purchaseNumber}
        description={<span className="flex flex-wrap items-center gap-2">{purchase.supplierName} <PurchaseStatusBadge status={purchase.status} /></span>}
        actions={<PurchaseActions id={purchase.id} status={purchase.status} outstanding={purchase.outstanding} canManage={can(session.user.role, "purchases:manage")} canPay={canPay} />}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <Card className="surface-elevated overflow-hidden py-0">
          <CardHeader className="pt-5"><CardTitle className="text-base">Items</CardTitle></CardHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="pl-5">Product</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit cost</TableHead>
                  <TableHead className="pr-5 text-right">Line total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchase.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="pl-5"><Link href={`/products/${item.productId}`} className="hover:underline">{item.productName}</Link><span className="block text-xs text-muted-foreground">{item.sku}</span></TableCell>
                    <TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
                    <TableCell className="text-right"><Money value={item.unitCost} /></TableCell>
                    <TableCell className="pr-5 text-right"><Money value={item.lineTotal} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
        <div className="space-y-4">
          <Card className="surface-elevated">
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Total</span><Money value={purchase.total} className="font-semibold" /></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Paid</span><Money value={purchase.paid} /></div>
              <div className="flex justify-between border-t pt-2"><span className="font-medium">Balance due</span><Money value={purchase.outstanding} className="font-semibold" /></div>
              {purchase.supplierReference && <p className="pt-2 text-muted-foreground">Supplier invoice: {purchase.supplierReference}</p>}
              {purchase.receivedAt && <p className="text-muted-foreground">Received {formatDateTime(purchase.receivedAt)}</p>}
              {purchase.cancelReason && <p className="text-muted-foreground">Cancelled: {purchase.cancelReason}</p>}
              {purchase.notes && <p className="text-muted-foreground">{purchase.notes}</p>}
            </CardContent>
          </Card>
          <Card className="surface-elevated">
            <CardHeader><CardTitle className="text-base">Payments to supplier</CardTitle></CardHeader>
            <CardContent>
              {purchase.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payments recorded.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {purchase.payments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                      <span>
                        <span className="font-medium">{p.paymentNumber}</span>{" "}
                        {p.kind === "REVERSAL" && <Badge variant="outline">Reversal</Badge>}
                        {p.isReversed && <Badge variant="outline" className="text-muted-foreground">Reversed</Badge>}
                        <span className="block text-xs text-muted-foreground">{formatDateTime(p.paidAt)} · {PAYMENT_METHOD_LABELS[p.method as PaymentMethod]}</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <Money value={p.amount} />
                        {canPay && p.kind === "PAYMENT" && !p.isReversed && <ReverseSupplierPaymentButton paymentId={p.id} />}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
