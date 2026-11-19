import type { Metadata } from "next";
import { ClipboardPlus, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Money } from "@/components/app/money";
import { OrderStatusBadge } from "@/components/app/order-status-badge";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateTime } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/validation/common";
import { requirePagePermission } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { getCustomer, getCustomerSummary } from "@/server/services/customers";
import { listOrders } from "@/server/services/orders";
import { listPayments } from "@/server/services/payments";
import { listSales } from "@/server/services/sales";
import { CustomerDialog } from "../customer-dialog";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  const session = await requirePagePermission("customers:view");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  const customer = await getCustomer(db, id).catch(() => null);
  if (!customer) notFound();
  const [summary, sales, orders, payments] = await Promise.all([
    getCustomerSummary(db, id),
    listSales(db, { customerId: id, pageSize: 20 }),
    listOrders(db, { customerId: id, pageSize: 20 }),
    listPayments(db, { customerId: id, pageSize: 20 }),
  ]);
  const role = session.user.role;

  return (
    <>
      <PageHeader eyebrow={`Customer since ${formatDate(customer.createdAt)}`} title={customer.fullName}
        description={[customer.phone, customer.email, customer.address].filter(Boolean).join(" · ") || undefined}
        actions={
          <>
            {can(role, "orders:manage") && <Button asChild variant="outline"><Link href={`/orders/new?customer=${id}`}><ClipboardPlus aria-hidden /> New order</Link></Button>}
            {can(role, "customers:manage") && <CustomerDialog customer={customer} />}
          </>
        } />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <StatCard label="Total spent" value={<Money value={summary.totalSpent} />} icon={ShoppingBag} />
        <StatCard label="Outstanding balance" value={<Money value={summary.balance} />} tone={summary.balance > 0 ? "warning" : "default"} />
        <StatCard label="Sales" value={summary.salesCount} />
        <StatCard label="Orders" value={summary.ordersCount} />
      </div>
      {customer.notes && <p className="mb-6 rounded-lg border bg-card p-3 text-sm">{customer.notes}</p>}
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="surface-elevated">
          <CardHeader><CardTitle className="text-base">Purchase history</CardTitle></CardHeader>
          <CardContent>
            {sales.items.length === 0 ? <p className="text-sm text-muted-foreground">No sales yet.</p> : (
              <ul className="divide-y text-sm">
                {sales.items.map((s) => (
                  <li key={s.id} className="flex justify-between gap-2 py-2">
                    <Link href={`/sales/${s.id}`} className="hover:underline">{s.saleNumber}<span className="block text-xs text-muted-foreground">{formatDateTime(s.createdAt)}{s.status === "VOIDED" ? " · voided" : ""}</span></Link>
                    <span className="text-right"><Money value={s.total} />{s.balance > 0 && <span className="block text-xs text-warning-foreground dark:text-warning">owes {(s.balance / 100).toFixed(2)}</span>}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card className="surface-elevated">
          <CardHeader><CardTitle className="text-base">Orders</CardTitle></CardHeader>
          <CardContent>
            {orders.items.length === 0 ? <p className="text-sm text-muted-foreground">No orders yet.</p> : (
              <ul className="divide-y text-sm">
                {orders.items.map((o) => (
                  <li key={o.id} className="flex justify-between gap-2 py-2">
                    <Link href={`/orders/${o.id}`} className="min-w-0 hover:underline">{o.orderNumber}<span className="block truncate text-xs text-muted-foreground">{o.title}</span></Link>
                    <span className="flex flex-col items-end gap-1"><Money value={o.totalAmount} /><OrderStatusBadge status={o.status} /></span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card className="surface-elevated">
          <CardHeader><CardTitle className="text-base">Payments</CardTitle></CardHeader>
          <CardContent>
            {payments.items.length === 0 ? <p className="text-sm text-muted-foreground">No payments yet.</p> : (
              <ul className="divide-y text-sm">
                {payments.items.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2 py-2">
                    <span>{PAYMENT_METHOD_LABELS[p.method as PaymentMethod]}<span className="block text-xs text-muted-foreground">{formatDateTime(p.receivedAt)} · {p.saleNumber ?? p.orderNumber}</span></span>
                    <Money value={p.amount} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
