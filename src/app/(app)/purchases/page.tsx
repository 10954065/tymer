import type { Metadata } from "next";
import { ClipboardPlus, Truck } from "lucide-react";
import Link from "next/link";
import { z } from "zod";
import { EmptyState } from "@/components/app/empty-state";
import { Money } from "@/components/app/money";
import { PageHeader } from "@/components/app/page-header";
import { PurchaseStatusBadge } from "@/components/app/status-badges";
import { buildHref, PaginationLinks } from "@/components/app/pagination-links";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { pageParam } from "@/lib/validation/common";
import { requirePagePermission } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { listPurchases, type PurchaseStatus } from "@/server/services/purchases";

export const metadata: Metadata = { title: "Purchases" };

const STATUSES: { value: PurchaseStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "DRAFT", label: "Awaiting delivery" },
  { value: "RECEIVED", label: "Received" },
  { value: "CANCELLED", label: "Cancelled" },
];

export default async function PurchasesPage({ searchParams }: PageProps<"/purchases">) {
  const session = await requirePagePermission("purchases:view");
  const params = await searchParams;
  const status = STATUSES.find((s) => s.value === params.status)?.value ?? "ALL";
  const supplierId = z.uuid().safeParse(params.supplier).success ? (params.supplier as string) : undefined;
  const page = pageParam.parse(params.page);
  const result = await listPurchases(getDb(), { status: status === "ALL" ? undefined : status, supplierId, page });
  const href = (o: Record<string, string | number | undefined>) => buildHref("/purchases", { status, supplier: supplierId, ...o });

  return (
    <>
      <PageHeader
        eyebrow="Stock"
        title="Purchases"
        description="Stock bought from suppliers. Purchases add to inventory value; their cost reaches profit only when goods are sold."
        actions={can(session.user.role, "purchases:manage") && (
          <Button asChild><Link href="/purchases/new"><ClipboardPlus aria-hidden /> New purchase</Link></Button>
        )}
      />
      <nav aria-label="Purchase status" className="mb-4 flex w-fit flex-wrap gap-1 rounded-lg bg-muted p-1">
        {STATUSES.map((s) => (
          <Link key={s.value} href={href({ status: s.value, page: undefined })} aria-current={s.value === status ? "page" : undefined}
            className={cn("rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground", s.value === status && "bg-card text-foreground shadow-sm")}>
            {s.label}
          </Link>
        ))}
      </nav>
      <Card className="surface-elevated overflow-hidden py-0">
        {result.items.length === 0 ? (
          <EmptyState icon={Truck} title="No purchases" description="Record supplier deliveries to bring stock in." className="m-4 border-none" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="pl-5">Purchase</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="pr-5 text-right">Balance due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="pl-5">
                      <Link href={`/purchases/${p.id}`} className="font-medium hover:underline">{p.purchaseNumber}</Link>
                      <span className="block text-xs text-muted-foreground">{formatDate(p.purchaseDate)}{p.supplierReference ? ` · ${p.supplierReference}` : ""}</span>
                    </TableCell>
                    <TableCell>{p.supplierName}</TableCell>
                    <TableCell><PurchaseStatusBadge status={p.status} /></TableCell>
                    <TableCell className="text-right"><Money value={p.total} /></TableCell>
                    <TableCell className="pr-5 text-right font-medium"><Money value={p.outstanding} /></TableCell>
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
