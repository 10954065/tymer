import type { Metadata } from "next";
import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Money } from "@/components/app/money";
import { PageHeader } from "@/components/app/page-header";
import { ProductThumb } from "@/components/app/product-thumb";
import { MovementBadge, ProductStatusBadge, QuantityChange } from "@/components/app/status-badges";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/dates";
import { toMoneyInput } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requirePagePermission } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { listMovements } from "@/server/services/inventory";
import { getPriceHistory, getProduct, getProductStats } from "@/server/services/products";
import { ProductActions } from "./product-actions";

export const metadata: Metadata = { title: "Product" };

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

export default async function ProductPage({ params, searchParams }: PageProps<"/products/[id]">) {
  const session = await requirePagePermission("products:view");
  const { id } = await params;
  const { before } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  const product = await getProduct(db, id).catch(() => null);
  if (!product) notFound();
  const beforeId = typeof before === "string" && /^\d+$/.test(before) ? Number(before) : undefined;
  const [stats, movements, priceHistory] = await Promise.all([
    getProductStats(db, id),
    listMovements(db, { productId: id, beforeId, limit: 50 }),
    getPriceHistory(db, id),
  ]);
  const role = session.user.role;
  const showCost = can(role, "products:view_cost");
  const removedFromPos = product.status !== "ACTIVE";

  return (
    <>
      <PageHeader
        eyebrow={product.categoryName ?? "Uncategorised"}
        title={product.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{product.sku}</span>
            {product.barcode && <span className="font-mono text-xs">· {product.barcode}</span>}
            <ProductStatusBadge status={product.status} />
          </span>
        }
        actions={
          <ProductActions
            product={{
              id: product.id,
              name: product.name,
              status: product.status,
              quantity: product.quantity,
              costPriceInput: showCost ? toMoneyInput(product.costPrice) : null,
            }}
            canManage={can(role, "products:manage")}
            canAdjust={can(role, "inventory:adjust")}
          />
        }
      />

      {removedFromPos && (
        <Alert className="mb-6 border-warning/50 bg-warning/10">
          <CircleAlert aria-hidden />
          <AlertTitle>
            {product.status === "OUT_OF_STOCK" ? "Sold out — removed from the POS automatically" : "Removed from the POS"}
          </AlertTitle>
          <AlertDescription>
            {product.status === "OUT_OF_STOCK"
              ? `Stock reached zero on ${formatDateTime(product.outOfStockAt)}. Use “Restock & reactivate” to sell it again.`
              : `${product.status === "DISCONTINUED" ? "Discontinued" : "Archived"} on ${formatDateTime(product.archivedAt)}${product.archiveReason ? ` — ${product.archiveReason}` : ""}.`}{" "}
            All sales, stock movements and profit history are preserved.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card className="surface-elevated h-fit">
          <CardContent className="space-y-4">
            <ProductThumb imageKey={product.imageKey} name={product.name} className="aspect-square size-auto w-full rounded-xl" />
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Selling price</dt><dd><Money value={product.sellingPrice} /></dd></div>
              {showCost && <div className="flex justify-between"><dt className="text-muted-foreground">Cost (avg.)</dt><dd><Money value={product.costPrice} /></dd></div>}
              <div className="flex justify-between"><dt className="text-muted-foreground">Reorder level</dt><dd className="tabular-nums">{product.reorderThreshold}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Supplier</dt><dd>{product.supplierName ?? "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Created</dt><dd>{formatDate(product.createdAt)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Last sold</dt><dd>{formatDate(stats.lastSoldAt)}</dd></div>
              {product.outOfStockAt && <div className="flex justify-between"><dt className="text-muted-foreground">Reached zero</dt><dd>{formatDate(product.outOfStockAt)}</dd></div>}
            </dl>
            {product.description && <p className="text-sm text-muted-foreground">{product.description}</p>}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Fact label="In stock now">{product.quantity}</Fact>
            <Fact label="Opening stock">{stats.initialStock}</Fact>
            <Fact label="Total purchased">{stats.purchased}</Fact>
            <Fact label="Total sold">{stats.sold}</Fact>
            <Fact label="Customer returns">{stats.returned}</Fact>
            <Fact label="Damaged / lost">{stats.writtenOff}</Fact>
            {showCost && <Fact label="Revenue"><Money value={stats.revenue} /></Fact>}
            {showCost && <Fact label="Gross profit"><Money value={stats.grossProfit} signed /></Fact>}
            {showCost && <Fact label="Cost of goods sold"><Money value={stats.cogs} /></Fact>}
          </dl>

          <Card className="surface-elevated overflow-hidden py-0">
            <CardHeader className="pt-5"><CardTitle className="text-base">Stock movement history</CardTitle></CardHeader>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="pl-5">Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Change</TableHead>
                    <TableHead className="text-right">Before → after</TableHead>
                    {showCost && <TableHead className="hidden text-right md:table-cell">Unit cost</TableHead>}
                    <TableHead className="hidden pr-5 md:table-cell">By / reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.rows.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="pl-5 text-sm whitespace-nowrap tabular-nums">{formatDateTime(m.createdAt)}</TableCell>
                      <TableCell><MovementBadge type={m.type} /></TableCell>
                      <TableCell className="text-right"><QuantityChange value={m.quantityChange} /></TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground tabular-nums">{m.previousQuantity} → {m.newQuantity}</TableCell>
                      {showCost && (
                        <TableCell className="hidden text-right text-sm md:table-cell">{m.unitCost == null ? "—" : <Money value={m.unitCost} />}</TableCell>
                      )}
                      <TableCell className="hidden max-w-64 truncate pr-5 text-sm text-muted-foreground md:table-cell">
                        {m.userName ?? "System"}{m.reason ? ` · ${m.reason}` : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {movements.nextBeforeId && (
              <div className="border-t p-3 text-center">
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/products/${id}?before=${movements.nextBeforeId}`}>Older movements</Link>
                </Button>
              </div>
            )}
          </Card>

          {priceHistory.length > 0 && (
            <Card className="surface-elevated overflow-hidden py-0">
              <CardHeader className="pt-5"><CardTitle className="text-base">Price history</CardTitle></CardHeader>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="pl-5">Date</TableHead>
                      <TableHead className="text-right">Selling price</TableHead>
                      {showCost && <TableHead className="text-right">Cost price</TableHead>}
                      <TableHead className="pr-5">Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {priceHistory.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="pl-5 text-sm tabular-nums">{formatDateTime(p.createdAt)}</TableCell>
                        <TableCell className="text-right text-sm"><Money value={p.oldSellingPrice} /> → <Money value={p.newSellingPrice} /></TableCell>
                        {showCost && <TableCell className="text-right text-sm"><Money value={p.oldCostPrice} /> → <Money value={p.newCostPrice} /></TableCell>}
                        <TableCell className="pr-5 text-sm text-muted-foreground">{p.reason ?? "—"} · {p.userName ?? "System"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
