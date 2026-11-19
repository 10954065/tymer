import type { Metadata } from "next";
import { Truck } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { Money } from "@/components/app/money";
import { PageHeader } from "@/components/app/page-header";
import { SearchBox } from "@/components/app/search-box";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/permissions";
import { searchParam } from "@/lib/validation/common";
import { requirePagePermission } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { listSuppliers } from "@/server/services/suppliers";
import { SupplierDialog } from "./supplier-dialog";

export const metadata: Metadata = { title: "Suppliers" };

export default async function SuppliersPage({ searchParams }: PageProps<"/suppliers">) {
  const session = await requirePagePermission("suppliers:view");
  const q = searchParam.parse((await searchParams).q);
  const rows = await listSuppliers(getDb(), q);
  const canManage = can(session.user.role, "suppliers:manage");
  const owed = rows.reduce((sum, r) => sum + Math.max(r.outstanding, 0), 0);

  return (
    <>
      <PageHeader
        eyebrow="Stock"
        title="Suppliers"
        description={<>Who you buy from and what you still owe them. Total outstanding: <Money value={owed} className="font-semibold text-foreground" /></>}
        actions={canManage && <SupplierDialog />}
      />
      <div className="mb-4 flex justify-end"><SearchBox placeholder="Search suppliers" /></div>
      <Card className="surface-elevated overflow-hidden py-0">
        {rows.length === 0 ? (
          <EmptyState icon={Truck} title="No suppliers" description="Add the businesses you buy stock from." className="m-4 border-none" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="pl-5">Supplier</TableHead>
                  <TableHead className="hidden md:table-cell">Contact</TableHead>
                  <TableHead className="text-right">Purchases</TableHead>
                  <TableHead className="text-right">Total bought</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead className="pr-5 text-right"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="pl-5">
                      <Link href={`/purchases?supplier=${s.id}`} className="font-medium hover:underline">{s.name}</Link>
                      {!s.isActive && <Badge variant="outline" className="ml-2">Inactive</Badge>}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {[s.contactPerson, s.phone, s.email].filter(Boolean).join(" · ") || "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.purchaseCount}</TableCell>
                    <TableCell className="text-right"><Money value={s.totalPurchased} /></TableCell>
                    <TableCell className="text-right font-medium"><Money value={s.outstanding} /></TableCell>
                    <TableCell className="pr-5 text-right">{canManage && <SupplierDialog supplier={s} />}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </>
  );
}
