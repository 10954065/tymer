import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Money } from "@/components/app/money";
import { OrderStatusBadge } from "@/components/app/order-status-badge";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/validation/common";
import { requirePagePermission } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { getOrder } from "@/server/services/orders";
import { ReversePaymentButton } from "../../sales/[id]/sale-actions";
import { OrderActions } from "./order-actions";

export const metadata: Metadata = { title: "Order" };

export default async function OrderPage({ params }: PageProps<"/orders/[id]">) {
  const session = await requirePagePermission("orders:view");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const order = await getOrder(getDb(), id).catch(() => null);
  if (!order) notFound();
  const role = session.user.role;
  const showCost = can(role, "reports:view");

  return (
    <>
      <PageHeader
        eyebrow={`Order · created ${formatDate(order.createdAt)}`}
        title={`${order.orderNumber} · ${order.title}`}
        description={<span className="flex flex-wrap items-center gap-2"><Link href={`/customers/${order.customerId}`} className="hover:underline">{order.customerName}</Link>{order.customerPhone && <span>· {order.customerPhone}</span>}<OrderStatusBadge status={order.status} /></span>}
        actions={<OrderActions orderId={order.id} status={order.status} outstanding={order.outstanding} paid={order.paid} canManage={can(role, "orders:manage")} canPay={can(role, "payments:record")} />}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card className="surface-elevated overflow-hidden py-0">
            <CardHeader className="pt-5"><CardTitle className="text-base">Products & services</CardTitle></CardHeader>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow className="bg-muted/40"><TableHead className="pl-5">Item</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Price</TableHead><TableHead className="pr-5 text-right">Total</TableHead></TableRow></TableHeader>
                <TableBody>
                  {order.items.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="pl-5">{i.description} <Badge variant="outline" className="ml-1">{i.kind === "PRODUCT" ? "Stock" : "Service"}</Badge>{i.sku && <span className="block text-xs text-muted-foreground">{i.sku}</span>}</TableCell>
                      <TableCell className="text-right tabular-nums">{i.quantity}</TableCell>
                      <TableCell className="text-right"><Money value={i.unitPrice} /></TableCell>
                      <TableCell className="pr-5 text-right"><Money value={i.lineTotal} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
          {order.description && <Card className="surface-elevated"><CardContent className="text-sm whitespace-pre-line">{order.description}</CardContent></Card>}
          <Card className="surface-elevated">
            <CardHeader><CardTitle className="text-base">Payments</CardTitle></CardHeader>
            <CardContent>
              {order.payments.length === 0 ? <p className="text-sm text-muted-foreground">No deposit yet.</p> : (
                <ul className="divide-y text-sm">
                  {order.payments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                      <span>{p.kind === "RECEIPT" ? "Payment" : p.kind === "REFUND" ? "Refund" : "Reversal"} · {PAYMENT_METHOD_LABELS[p.method as PaymentMethod]}{p.isReversed && <Badge variant="outline" className="ml-1">Reversed</Badge>}
                        <span className="block text-xs text-muted-foreground">{p.paymentNumber} · {formatDateTime(p.receivedAt)} · {p.receivedByName}</span></span>
                      <span className="flex items-center gap-1"><Money value={p.amount} />{p.kind === "RECEIPT" && !p.isReversed && order.status !== "CANCELLED" && can(role, "payments:reverse") && <ReversePaymentButton paymentId={p.id} />}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-4">
          <Card className="surface-elevated">
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between font-semibold"><span>Agreed price</span><Money value={order.totalAmount} /></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Collected</span><Money value={order.paid} /></div>
              <div className="flex justify-between border-t pt-2 font-semibold"><span>Balance</span><Money value={order.outstanding} /></div>
              <p className="pt-2 text-xs text-muted-foreground">Due {formatDate(order.expectedCompletionDate)} · {order.fulfilment === "DELIVERY" ? `Delivery to ${order.deliveryAddress ?? "—"}` : "Customer collects"}</p>
              {order.completedAt && <p className="text-xs text-muted-foreground">Completed {formatDateTime(order.completedAt)}</p>}
              {order.cancelReason && <p className="text-xs text-muted-foreground">Cancelled: {order.cancelReason}</p>}
            </CardContent>
          </Card>
          {showCost && (
            <Card className="surface-elevated">
              <CardHeader><CardTitle className="text-base">Profitability</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Est. materials</span><Money value={order.estimatedMaterialsCost} /></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Est. labour</span><Money value={order.estimatedLabourCost} /></div>
                <div className="flex justify-between"><span>Estimated profit</span><Money value={order.estimatedProfit} signed /></div>
                <div className="flex justify-between border-t pt-2"><span className="text-muted-foreground">Stock items used</span><Money value={order.productCostTotal} /></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Direct costs (expenses)</span><Money value={order.directCostTotal} /></div>
                <div className="flex justify-between font-semibold"><span>Actual profit</span>{order.actualProfit === null ? <span className="text-muted-foreground">On completion</span> : <Money value={order.actualProfit} signed />}</div>
                {order.directCosts.length > 0 && (
                  <ul className="border-t pt-2 text-xs text-muted-foreground">
                    {order.directCosts.map((e) => <li key={e.id} className="flex justify-between"><span>{e.description} ({e.category})</span><Money value={e.amount} /></li>)}
                  </ul>
                )}
                <p className="text-xs text-muted-foreground">Record materials or labour as an expense linked to this order (Expenses page).</p>
              </CardContent>
            </Card>
          )}
          {order.internalNotes && <p className="text-sm text-muted-foreground">Notes: {order.internalNotes}</p>}
        </div>
      </div>
    </>
  );
}
