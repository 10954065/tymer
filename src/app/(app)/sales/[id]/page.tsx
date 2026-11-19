import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Money } from "@/components/app/money";
import { PageHeader } from "@/components/app/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/dates";
import { mulDivRound } from "@/lib/money";
import { can } from "@/lib/permissions";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/validation/common";
import { requirePagePermission } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { getSale } from "@/server/services/sales";
import { ReversePaymentButton, SaleActions } from "./sale-actions";

export const metadata: Metadata = { title: "Sale" };

const KIND_LABEL: Record<string, string> = { RECEIPT: "Payment", REFUND: "Refund", REVERSAL: "Reversal" };

export default async function SalePage({ params }: PageProps<"/sales/[id]">) {
  const session = await requirePagePermission("sales:view");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const sale = await getSale(getDb(), id).catch(() => null);
  if (!sale) notFound();
  const role = session.user.role;
  const showCost = can(role, "products:view_cost");

  return (
    <>
      <PageHeader
        eyebrow={formatDateTime(sale.createdAt)}
        title={sale.saleNumber}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {sale.customerName ? <Link href={`/customers/${sale.customerId}`} className="hover:underline">{sale.customerName}</Link> : "Walk-in customer"}
            · served by {sale.cashierName}
            {sale.status === "VOIDED" && <Badge variant="destructive">Voided</Badge>}
            {sale.source === "OFFLINE" && <Badge variant="secondary">Recorded offline</Badge>}
          </span>
        }
        actions={
          <SaleActions
            saleId={sale.id}
            status={sale.status}
            balance={sale.balance}
            paid={sale.paid}
            hasReturns={sale.returns.length > 0}
            items={sale.items.map((i) => ({
              id: i.id,
              productName: i.productName,
              remaining: i.quantity - i.returnedQuantity,
              unitValue: mulDivRound(i.lineTotal, 1, i.quantity),
            }))}
            can={{ pay: can(role, "payments:record"), void: can(role, "sales:void"), return: can(role, "sales:return") }}
          />
        }
      />
      {sale.status === "VOIDED" && (
        <Alert className="mb-6 border-destructive/40">
          <AlertTitle>Voided on {formatDateTime(sale.voidedAt)}</AlertTitle>
          <AlertDescription>{sale.voidReason}. Stock was restored and payments reversed; this sale is excluded from revenue.</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card className="surface-elevated overflow-hidden py-0">
            <CardHeader className="pt-5"><CardTitle className="text-base">Items (as sold)</CardTitle></CardHeader>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="pl-5">Product</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Discount</TableHead>
                    {showCost && <TableHead className="hidden text-right md:table-cell">Unit cost</TableHead>}
                    <TableHead className="pr-5 text-right">Line total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sale.items.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="pl-5">
                        <Link href={`/products/${i.productId}`} className="hover:underline">{i.productName}</Link>
                        <span className="block text-xs text-muted-foreground">{i.sku}{i.returnedQuantity > 0 ? ` · ${i.returnedQuantity} returned` : ""}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{i.quantity}</TableCell>
                      <TableCell className="text-right"><Money value={i.unitPrice} /></TableCell>
                      <TableCell className="text-right text-muted-foreground">{i.discount ? <Money value={i.discount} /> : "—"}</TableCell>
                      {showCost && <TableCell className="hidden text-right text-muted-foreground md:table-cell"><Money value={i.unitCost} /></TableCell>}
                      <TableCell className="pr-5 text-right"><Money value={i.lineTotal} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
          {sale.returns.length > 0 && (
            <Card className="surface-elevated">
              <CardHeader><CardTitle className="text-base">Returns</CardTitle></CardHeader>
              <CardContent>
                <ul className="divide-y text-sm">
                  {sale.returns.map((r) => (
                    <li key={r.id} className="flex justify-between gap-3 py-2">
                      <span><span className="font-medium">{r.returnNumber}</span> · {r.reason}<span className="block text-xs text-muted-foreground">{formatDateTime(r.createdAt)} · {r.createdByName} · {r.items.reduce((s, i) => s + i.quantity, 0)} item(s){r.items.some((i) => !i.restocked) ? " (some not restocked)" : ""}</span></span>
                      <Money value={-(r.valueTotal + r.taxTotal)} />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
        <div className="space-y-4">
          <Card className="surface-elevated">
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><Money value={sale.subtotal} /></div>
              {sale.discountTotal > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Discounts</span><Money value={-sale.discountTotal} /></div>}
              {sale.taxTotal > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><Money value={sale.taxTotal} /></div>}
              <div className="flex justify-between font-semibold"><span>Total</span><Money value={sale.total} /></div>
              {sale.returned > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Returned</span><Money value={-sale.returned} /></div>}
              <div className="flex justify-between"><span className="text-muted-foreground">Paid (net)</span><Money value={sale.paid} /></div>
              <div className="flex justify-between border-t pt-2 font-semibold"><span>Balance</span><Money value={sale.balance} /></div>
              {showCost && <div className="flex justify-between pt-2 text-xs text-muted-foreground"><span>Cost of goods</span><Money value={sale.costTotal} /></div>}
            </CardContent>
          </Card>
          <Card className="surface-elevated">
            <CardHeader><CardTitle className="text-base">Payments</CardTitle></CardHeader>
            <CardContent>
              {sale.payments.length === 0 ? <p className="text-sm text-muted-foreground">No payments yet.</p> : (
                <ul className="divide-y text-sm">
                  {sale.payments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                      <span>
                        <span className="font-medium">{KIND_LABEL[p.kind]}</span> · {PAYMENT_METHOD_LABELS[p.method as PaymentMethod]}
                        {p.isReversed && <Badge variant="outline" className="ml-1">Reversed</Badge>}
                        <span className="block text-xs text-muted-foreground">{p.paymentNumber} · {formatDateTime(p.receivedAt)}{p.externalReference ? ` · ${p.externalReference}` : ""}</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <Money value={p.amount} />
                        {p.kind === "RECEIPT" && !p.isReversed && sale.status === "COMPLETED" && can(role, "payments:reverse") && <ReversePaymentButton paymentId={p.id} />}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          {sale.notes && <p className="text-sm text-muted-foreground">Note: {sale.notes}</p>}
        </div>
      </div>
    </>
  );
}
