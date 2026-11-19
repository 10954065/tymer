import type { Metadata } from "next";
import { FolderTree } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePagePermission } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { listCategories } from "@/server/services/categories";
import { CategoryDialog } from "./category-dialog";

export const metadata: Metadata = { title: "Categories" };

export default async function CategoriesPage() {
  await requirePagePermission("categories:manage");
  const rows = await listCategories(getDb());
  return (
    <>
      <PageHeader eyebrow="Stock" title="Categories" description="Group products so they are quick to find at the POS." actions={<CategoryDialog />} />
      <Card className="surface-elevated overflow-hidden py-0">
        {rows.length === 0 ? (
          <EmptyState icon={FolderTree} title="No categories yet" description="Create categories such as Vases, Lighting or Wall art." className="m-4 border-none" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="pl-5">Category</TableHead>
                  <TableHead className="text-right">Products</TableHead>
                  <TableHead className="text-right">In catalogue</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-5 text-right"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="pl-5">
                      <p className="font-medium">{c.name}</p>
                      {c.description && <p className="text-xs text-muted-foreground">{c.description}</p>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Link href={`/products?filter=all&q=`} className="hover:underline">{c.productCount}</Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.activeProductCount}</TableCell>
                    <TableCell>
                      {c.isActive ? <Badge variant="outline" className="border-success/40 text-success">Active</Badge> : <Badge variant="outline">Inactive</Badge>}
                    </TableCell>
                    <TableCell className="pr-5 text-right"><CategoryDialog category={c} /></TableCell>
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
