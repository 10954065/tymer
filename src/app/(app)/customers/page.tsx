import type { Metadata } from "next";
import { Users } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { Money } from "@/components/app/money";
import { PageHeader } from "@/components/app/page-header";
import { buildHref, PaginationLinks } from "@/components/app/pagination-links";
import { SearchBox } from "@/components/app/search-box";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { pageParam, searchParam } from "@/lib/validation/common";
import { requirePagePermission } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { listCustomers } from "@/server/services/customers";
import { CustomerDialog } from "./customer-dialog";

export const metadata: Metadata = { title: "Customers" };

const SORTS = [
  { value: "name", label: "A–Z" },
  { value: "spend", label: "Top spenders" },
  { value: "balance", label: "Owing money" },
] as const;

export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  const session = await requirePagePermission("customers:view");
  const params = await searchParams;
  const q = searchParam.parse(params.q);
  const page = pageParam.parse(params.page);
  const sort = SORTS.find((s) => s.value === params.sort)?.value ?? "name";
  const result = await listCustomers(getDb(), { search: q, page, sort });
  const href = (o: Record<string, string | number | undefined>) => buildHref("/customers", { q, sort, ...o });

  return (
    <>
      <PageHeader eyebrow="Selling" title="Customers" description="Purchase history, orders, payments and balances for each customer. Walk-in sales need no profile."
        actions={can(session.user.role, "customers:create") && <CustomerDialog />} />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Sort" className="flex gap-1 rounded-lg bg-muted p-1">
          {SORTS.map((s) => (
            <Link key={s.value} href={href({ sort: s.value, page: undefined })} className={cn("rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground", sort === s.value && "bg-card text-foreground shadow-sm")}>{s.label}</Link>
          ))}
        </nav>
        <SearchBox placeholder="Name or phone" />
      </div>
      <Card className="surface-elevated overflow-hidden py-0">
        {result.items.length === 0 ? (
          <EmptyState icon={Users} title="No customers found" className="m-4 border-none" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="pl-5">Customer</TableHead>
                  <TableHead className="text-right">Sales</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Total spent</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="hidden pr-5 md:table-cell">Last purchase</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="pl-5">
                      <Link href={`/customers/${c.id}`} className="font-medium hover:underline">{c.fullName}</Link>
                      {c.salesCount + c.ordersCount > 1 && <Badge variant="secondary" className="ml-2">Repeat</Badge>}
                      <span className="block text-xs text-muted-foreground">{c.phone ?? c.email ?? "—"}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.salesCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.ordersCount}</TableCell>
                    <TableCell className="text-right"><Money value={c.totalSpent} /></TableCell>
                    <TableCell className="text-right">{c.balance > 0 ? <Money value={c.balance} className="font-semibold" /> : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="hidden pr-5 text-sm text-muted-foreground md:table-cell">{formatDate(c.lastPurchaseAt)}</TableCell>
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
