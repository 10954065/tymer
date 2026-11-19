import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/app/page-header";
import { PRODUCT_FORM_NONE, ProductForm } from "@/components/app/product-form";
import { toMoneyInput } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requirePagePermission } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { listCategoryOptions } from "@/server/services/categories";
import { getProduct } from "@/server/services/products";
import { listSupplierOptions } from "@/server/services/suppliers";

export const metadata: Metadata = { title: "Edit product" };

export default async function EditProductPage({ params }: PageProps<"/products/[id]/edit">) {
  const session = await requirePagePermission("products:manage");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  const [product, categories, suppliers] = await Promise.all([
    getProduct(db, id).catch(() => null),
    listCategoryOptions(db),
    listSupplierOptions(db),
  ]);
  if (!product) notFound();

  return (
    <>
      <PageHeader eyebrow={product.sku} title={`Edit ${product.name}`} />
      <ProductForm
        mode="edit"
        categories={categories}
        suppliers={suppliers}
        canViewCost={can(session.user.role, "products:view_cost")}
        defaults={{
          id: product.id,
          name: product.name,
          sku: product.sku,
          barcode: product.barcode ?? "",
          categoryId: product.categoryId ?? PRODUCT_FORM_NONE,
          supplierId: product.supplierId ?? PRODUCT_FORM_NONE,
          description: product.description ?? "",
          costPrice: toMoneyInput(product.costPrice),
          sellingPrice: toMoneyInput(product.sellingPrice),
          reorderThreshold: product.reorderThreshold,
          imageKey: product.imageKey,
          priceChangeReason: "",
        }}
      />
    </>
  );
}
