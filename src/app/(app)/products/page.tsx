import type { Metadata } from "next";
import { PackagePlus, PackageSearch } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { Money } from "@/components/app/money";
import { PageHeader } from "@/components/app/page-header";
import { buildHref, PaginationLinks } from "@/components/app/pagination-links";
import { ProductThumb } from "@/components/app/product-thumb";
import { SearchBox } from "@/components/app/search-box";
import { ProductStatusBadge } from "@/components/app/status-badges";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { pageParam, searchParam } from "@/lib/validation/common";
import { requirePagePermission } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { listProducts, type ProductListFilter } from "@/server/services/products";

export const metadata: Metadata = { title: "Products" };

const FILTERS: { value: ProductListFilter; label: string }[] = [
  { value: "active", label: "In catalogue" },
  { value: "low", label: "Low stock" },
  { value: "archived", label: "Archived / out of stock" },
  { value: "all", label: "All" },
];

export default async function ProductsPage({ searchParams }: PageProps<"/products">) {
  const session = await requirePagePermission("products:view");
  const params = await searchParams;
  const q = searchParam.parse(params.q);
  const page = pageParam.parse(params.page);
  const filter = FILTERS.find((f) => f.value === params.filter)?.value ?? "active";
  const result = await listProducts(getDb(), { search: q, filter, page });
  const showCost = can(session.user.role, "products:view_cost");
  const canManage = can(session.user.role, "products:manage");
  const href = (overrides: Record<string, string | number | undefined>) =>
    buildHref("/products", { q, filter, page: undefined, ...overrides });

  return (
    <>
      <PageHeader
        eyebrow="Stock"
        title="Products"
        description="Everything the shop sells. Products that sell out leave the POS automatically and keep their full history."
        actions={
          canManage && (
            <Button asChild>
              <Link href="/products/new">
                <PackagePlus aria-hidden /> Add product
              </Link>
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Product filters" className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
          {FILTERS.map((f) => (
            <Link
              key={f.value}
              href={href({ filter: f.value })}
              aria-current={f.value === filter ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                f.value === filter && "bg-card text-foreground shadow-sm",
              )}
            >
              {f.label}
            </Link>
          ))}
        </nav>
        <SearchBox placeholder="Search name, SKU or barcode" />
      </div>

      <Card className="surface-elevated overflow-hidden py-0">
        {result.items.length === 0 ? (
          <EmptyState
            icon={PackageSearch}
            title={q ? "No matching products" : "No products here yet"}
            description={q ? "Try another name, SKU or barcode." : "Add products to start selling."}
            className="m-4 border-none"
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="pl-5">Product</TableHead>
                  <TableHead className="hidden md:table-cell">Category</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  {showCost && <TableHead className="hidden text-right lg:table-cell">Cost</TableHead>}
                  <TableHead className="text-right">In stock</TableHead>
                  <TableHead className="pr-5">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((p) => (
                  <TableRow key={p.id} className="group">
                    <TableCell className="pl-5">
                      <Link href={`/products/${p.id}`} className="flex items-center gap-3">
                        <ProductThumb imageKey={p.imageKey} name={p.name} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium group-hover:underline">{p.name}</span>
                          <span className="text-xs text-muted-foreground">{p.sku}</span>
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{p.categoryName ?? "—"}</TableCell>
                    <TableCell className="text-right"><Money value={p.sellingPrice} /></TableCell>
                    {showCost && (
                      <TableCell className="hidden text-right text-muted-foreground lg:table-cell"><Money value={p.costPrice} /></TableCell>
                    )}
                    <TableCell className={cn("text-right tabular-nums", p.quantity <= p.reorderThreshold && "font-semibold text-warning-foreground dark:text-warning")}>
                      {p.quantity}
                    </TableCell>
                    <TableCell className="pr-5"><ProductStatusBadge status={p.status} /></TableCell>
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
