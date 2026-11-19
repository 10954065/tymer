import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { PRODUCT_FORM_NONE, ProductForm } from "@/components/app/product-form";
import { can } from "@/lib/permissions";
import { requirePagePermission } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { listCategoryOptions } from "@/server/services/categories";
import { getSettings } from "@/server/services/settings";
import { listSupplierOptions } from "@/server/services/suppliers";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage() {
  const session = await requirePagePermission("products:manage");
  const db = getDb();
  const [categories, suppliers, settings] = await Promise.all([listCategoryOptions(db), listSupplierOptions(db), getSettings(db)]);
  return (
    <>
      <PageHeader eyebrow="Products" title="Add a product" />
      <ProductForm
        mode="create"
        categories={categories}
        suppliers={suppliers}
        canViewCost={can(session.user.role, "products:view_cost")}
        defaults={{
          name: "",
          sku: "",
          barcode: "",
          categoryId: PRODUCT_FORM_NONE,
          supplierId: PRODUCT_FORM_NONE,
          description: "",
          costPrice: "",
          sellingPrice: "",
          reorderThreshold: settings.defaultReorderThreshold,
          imageKey: null,
          initialStock: 0,
        }}
      />
    </>
  );
}
