import type { Metadata } from "next";
import { ClipboardList, Plus } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { Money } from "@/components/app/money";
import { OrderStatusBadge } from "@/components/app/order-status-badge";
import { PageHeader } from "@/components/app/page-header";
import { buildHref, PaginationLinks } from "@/components/app/pagination-links";
import { SearchBox } from "@/components/app/search-box";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { pageParam, searchParam } from "@/lib/validation/common";
import { requirePagePermission } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { listOrders, type OrderStatus } from "@/server/services/orders";

export const metadata: Metadata = { title: "Orders" };

const TABS: { value: OrderStatus | "OPEN" | "ALL"; label: string }[] = [
  { value: "OPEN", label: "Open" },
  { value: "READY", label: "Ready" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "ALL", label: "All" },
];

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  const session = await requirePagePermission("orders:view");
  const params = await searchParams;
  const tab = TABS.find((t) => t.value === params.status)?.value ?? "OPEN";
  const q = searchParam.parse(params.q);
  const page = pageParam.parse(params.page);
  const result = await listOrders(getDb(), { status: tab === "ALL" ? undefined : tab, search: q, page });
  const href = (o: Record<string, string | number | undefined>) => buildHref("/orders", { status: tab, q, ...o });

  return (
    <>
      <PageHeader
        eyebrow="Selling"
        title="Customer orders"
        description="Custom decoration jobs from deposit to completion. Deposits are payments; revenue is counted when an order is completed."
        actions={can(session.user.role, "orders:manage") && <Button asChild><Link href="/orders/new"><Plus aria-hidden /> New order</Link></Button>}
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Order status" className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
          {TABS.map((t) => (
            <Link key={t.value} href={buildHref("/orders", { status: t.value, q })} aria-current={t.value === tab ? "page" : undefined}
              className={cn("rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground", t.value === tab && "bg-card text-foreground shadow-sm")}>{t.label}</Link>
          ))}
        </nav>
        <SearchBox placeholder="Order number, title or customer" />
      </div>
      <Card className="surface-elevated overflow-hidden py-0">
        {result.items.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No orders here" description="Create an order when a customer commissions a decoration job." className="m-4 border-none" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="pl-5">Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Due</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="pr-5 text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="pl-5"><Link href={`/orders/${o.id}`} className="font-medium hover:underline">{o.orderNumber}</Link><span className="block max-w-56 truncate text-xs text-muted-foreground">{o.title}</span></TableCell>
                    <TableCell>{o.customerName}</TableCell>
                    <TableCell><OrderStatusBadge status={o.status} /></TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{formatDate(o.expectedCompletionDate)}</TableCell>
                    <TableCell className="text-right"><Money value={o.totalAmount} /></TableCell>
                    <TableCell className="pr-5 text-right font-medium"><Money value={o.outstanding} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
      <PaginationLinks page={result.page} pageSize={result.pageSize} total={result.total} hrefFor={(n) => href({ page: n })} />
    </>
  );
}
