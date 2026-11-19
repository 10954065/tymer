import type { Metadata } from "next";
import { Boxes, Package } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { Money } from "@/components/app/money";
import { PageHeader } from "@/components/app/page-header";
import { buildHref, PaginationLinks } from "@/components/app/pagination-links";
import { ProductThumb } from "@/components/app/product-thumb";
import { SearchBox } from "@/components/app/search-box";
import { MOVEMENT_LABELS, MovementBadge, ProductStatusBadge, QuantityChange } from "@/components/app/status-badges";
import { StatCard } from "@/components/app/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { pageParam, searchParam } from "@/lib/validation/common";
import { requirePagePermission } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { listMovements, type MovementType } from "@/server/services/inventory";
import { listProducts, type ProductListFilter } from "@/server/services/products";
import { getInventoryValuation } from "@/server/services/reports/financials";

export const metadata: Metadata = { title: "Inventory" };

const TABS = [
  { value: "stock", label: "Stock on hand" },
  { value: "low", label: "Low stock" },
  { value: "archived", label: "Archived / out of stock" },
  { value: "movements", label: "Movement ledger" },
] as const;
type Tab = (typeof TABS)[number]["value"];

export default async function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  const session = await requirePagePermission("inventory:view");
  const params = await searchParams;
  const requested = params.tab ?? (params.filter === "low" ? "low" : undefined);
  const tab: Tab = TABS.find((t) => t.value === requested)?.value ?? "stock";
  const q = searchParam.parse(params.q);
  const page = pageParam.parse(params.page);
  const showCost = can(session.user.role, "products:view_cost");
  const valuation = showCost ? await getInventoryValuation(getDb()) : null;
  const movementType = typeof params.type === "string" && params.type in MOVEMENT_LABELS ? (params.type as MovementType) : undefined;
  const beforeId = typeof params.before === "string" ? Number(params.before) || undefined : undefined;

  return (
    <>
      <PageHeader
        eyebrow="Stock"
        title="Inventory"
        description="Stock on hand, items to reorder, sold-out and archived products, and the complete stock ledger."
      />
      {valuation && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <StatCard label="Inventory value at cost" value={<Money value={valuation.value} />} icon={Boxes} />
          <StatCard label="Retail value" value={<Money value={valuation.retailValue} />} hint="At current selling prices" />
          <StatCard label="Units on hand" value={valuation.units.toLocaleString("en-GH")} hint={`${valuation.productsInStock} products in stock`} />
        </div>
      )}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Inventory views" className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
          {TABS.map((t) => (
            <Link key={t.value} href={buildHref("/inventory", { tab: t.value })} aria-current={t.value === tab ? "page" : undefined}
              className={cn("rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground", t.value === tab && "bg-card text-foreground shadow-sm")}>
              {t.label}
            </Link>
          ))}
        </nav>
        {tab !== "movements" && <SearchBox placeholder="Search products" />}
      </div>
      {tab === "movements" ? (
        <MovementLedger beforeId={beforeId} type={movementType} showCost={showCost} />
      ) : (
        <StockTable filter={tab === "stock" ? "active" : tab} search={q} page={page} showCost={showCost}
          hrefFor={(n) => buildHref("/inventory", { tab, q, page: n })} />
      )}
    </>
  );
}

interface StockTableProps {
  filter: ProductListFilter;
  search: string;
  page: number;
  showCost: boolean;
  hrefFor: (n: number) => string;
}

async function StockTable({ filter, search, page, showCost, hrefFor }: StockTableProps) {
  const result = await listProducts(getDb(), { filter, search, page });
  const archived = filter === "archived";
  if (result.items.length === 0) {
    return (
      <EmptyState icon={Package} title={archived ? "Nothing archived" : filter === "low" ? "Nothing to reorder" : "No stock yet"}
        description={archived ? "Products that sell out or are archived appear here with their full history." : undefined} />
    );
  }
  return (
    <>
      <Card className="surface-elevated overflow-hidden py-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="pl-5">Product</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Reorder at</TableHead>
                {showCost && <TableHead className="text-right">Value at cost</TableHead>}
                <TableHead>{archived ? "Removed on" : "Status"}</TableHead>
                <TableHead className="pr-5 text-right"><span className="sr-only">Open</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="pl-5">
                    <span className="flex items-center gap-3">
                      <ProductThumb imageKey={p.imageKey} name={p.name} />
                      <span><span className="block font-medium">{p.name}</span><span className="text-xs text-muted-foreground">{p.sku}</span></span>
                    </span>
                  </TableCell>
                  <TableCell className={cn("text-right tabular-nums", p.quantity <= p.reorderThreshold && "font-semibold text-destructive")}>{p.quantity}</TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">{p.reorderThreshold}</TableCell>
                  {showCost && <TableCell className="text-right"><Money value={Math.max(p.quantity, 0) * p.costPrice} /></TableCell>}
                  <TableCell>
                    {archived ? (
                      <span className="flex items-center gap-2 text-sm"><ProductStatusBadge status={p.status} /> {formatDate(p.archivedAt ?? p.outOfStockAt)}</span>
                    ) : (
                      <ProductStatusBadge status={p.status} />
                    )}
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    <Button asChild variant="ghost" size="sm"><Link href={`/products/${p.id}`}>{archived ? "History & restock" : "Open"}</Link></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
      <PaginationLinks page={result.page} pageSize={result.pageSize} total={result.total} hrefFor={hrefFor} />
    </>
  );
}

async function MovementLedger({ beforeId, type, showCost }: { beforeId?: number; type?: MovementType; showCost: boolean }) {
  const { rows, nextBeforeId } = await listMovements(getDb(), { beforeId, type, limit: 50 });
  const chip = (active: boolean) => cn("rounded-full border px-3 py-1 text-xs", active && "border-primary bg-accent text-accent-foreground");
  return (
    <>
      <nav aria-label="Movement type" className="mb-3 flex flex-wrap gap-1.5">
        <Link href={buildHref("/inventory", { tab: "movements" })} className={chip(!type)}>All</Link>
        {Object.entries(MOVEMENT_LABELS).map(([value, label]) => (
          <Link key={value} href={buildHref("/inventory", { tab: "movements", type: value })} className={chip(type === value)}>{label}</Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <EmptyState icon={Boxes} title="No stock movements" description="Every sale, purchase, return and adjustment is recorded here." />
      ) : (
        <Card className="surface-elevated overflow-hidden py-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="pl-5">Date</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                  <TableHead className="text-right">Before → after</TableHead>
                  {showCost && <TableHead className="hidden text-right lg:table-cell">Unit cost</TableHead>}
                  <TableHead className="hidden pr-5 md:table-cell">By / reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="pl-5 text-sm whitespace-nowrap tabular-nums">{formatDateTime(m.createdAt)}</TableCell>
                    <TableCell>
                      <Link href={`/products/${m.productId}`} className="hover:underline">{m.productName}</Link>
                      <span className="block text-xs text-muted-foreground">{m.sku}</span>
                    </TableCell>
                    <TableCell><MovementBadge type={m.type} /></TableCell>
                    <TableCell className="text-right"><QuantityChange value={m.quantityChange} /></TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground tabular-nums">{m.previousQuantity} → {m.newQuantity}</TableCell>
                    {showCost && <TableCell className="hidden text-right text-sm lg:table-cell">{m.unitCost == null ? "—" : <Money value={m.unitCost} />}</TableCell>}
                    <TableCell className="hidden max-w-60 truncate pr-5 text-sm text-muted-foreground md:table-cell">
                      {m.userName ?? "System"}{m.reason ? ` · ${m.reason}` : ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {nextBeforeId && (
            <div className="border-t p-3 text-center">
              <Button asChild variant="ghost" size="sm">
                <Link href={buildHref("/inventory", { tab: "movements", type, before: nextBeforeId })}>Older movements</Link>
              </Button>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
