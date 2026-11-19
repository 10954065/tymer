import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { todayBusinessDate } from "@/lib/dates";
import { requirePagePermission } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { listProductOptions } from "@/server/services/products";
import { listSupplierOptions } from "@/server/services/suppliers";
import { PurchaseForm } from "./purchase-form";

export const metadata: Metadata = { title: "New purchase" };

export default async function NewPurchasePage({ searchParams }: PageProps<"/purchases/new">) {
  await requirePagePermission("purchases:manage");
  const db = getDb();
  const [suppliers, products] = await Promise.all([listSupplierOptions(db), listProductOptions(db)]);
  const { supplier } = await searchParams;
  return (
    <>
      <PageHeader eyebrow="Purchases" title="Record a stock purchase" description="Received goods increase stock at the unit cost you enter; cost prices become a weighted average." />
      <PurchaseForm suppliers={suppliers} products={products} today={todayBusinessDate()} defaultSupplierId={typeof supplier === "string" ? supplier : undefined} />
    </>
  );
}
