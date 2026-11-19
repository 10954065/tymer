import type { Metadata } from "next";
import { can } from "@/lib/permissions";
import { requirePagePermission } from "@/server/auth/current-user";
import { getCachedCatalog, getCachedCategories } from "@/server/queries/catalog";
import { getCachedSettings } from "@/server/queries/settings";
import { PosClient } from "./pos-client";

export const metadata: Metadata = { title: "POS" };

export default async function PosPage() {
  const session = await requirePagePermission("pos:use");
  const [catalog, categories, settings] = await Promise.all([getCachedCatalog(), getCachedCategories(), getCachedSettings()]);
  return (
    <PosClient
      products={catalog.map(({ categoryName: _c, ...p }) => p)}
      categories={categories}
      taxRateBps={settings.taxRateBps}
      taxLabel={settings.taxLabel ?? "Tax"}
      allowNegativeStock={settings.allowNegativeStock}
      canCreateCustomer={can(session.user.role, "customers:create")}
    />
  );
}
