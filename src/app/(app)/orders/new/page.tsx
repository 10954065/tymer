import type { Metadata } from "next";
import { z } from "zod";
import { PageHeader } from "@/components/app/page-header";
import { toMoneyInput } from "@/lib/money";
import { requirePagePermission } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { getCustomer } from "@/server/services/customers";
import { getOrder } from "@/server/services/orders";
import { getPosCatalog } from "@/server/services/products";
import { OrderForm } from "./order-form";

export const metadata: Metadata = { title: "Order" };

/** Creates a new order, or edits an open one with ?edit=<orderId>. */
export default async function NewOrderPage({ searchParams }: PageProps<"/orders/new">) {
  await requirePagePermission("orders:manage");
  const params = await searchParams;
  const db = getDb();
  const products = (await getPosCatalog(db)).map((p) => ({ id: p.id, name: p.name, sku: p.sku, sellingPrice: p.sellingPrice }));
  const editId = z.uuid().safeParse(params.edit).success ? (params.edit as string) : null;
  const order = editId ? await getOrder(db, editId).catch(() => null) : null;
  const customerId = order?.customerId ?? (z.uuid().safeParse(params.customer).success ? (params.customer as string) : null);
  const customer = customerId ? await getCustomer(db, customerId).catch(() => null) : null;

  return (
    <>
      <PageHeader eyebrow="Orders" title={order ? `Edit ${order.orderNumber}` : "New customer order"} description="Custom decoration jobs, made-to-order items and services." />
      <OrderForm
        products={products}
        orderId={order?.id}
        initialCustomer={customer ? { id: customer.id, fullName: customer.fullName, phone: customer.phone } : null}
        defaults={{
          customerId: customer?.id ?? "",
          title: order?.title ?? "",
          description: order?.description ?? "",
          items: order
            ? order.items.map((i) => ({ kind: i.kind, productId: i.productId, description: i.description, quantity: i.quantity, unitPrice: toMoneyInput(i.unitPrice) }))
            : [{ kind: "SERVICE", productId: null, description: "", quantity: 1, unitPrice: "" }],
          estimatedMaterialsCost: toMoneyInput(order?.estimatedMaterialsCost ?? 0),
          estimatedLabourCost: toMoneyInput(order?.estimatedLabourCost ?? 0),
          expectedCompletionDate: order?.expectedCompletionDate ?? "",
          fulfilment: order?.fulfilment ?? "COLLECTION",
          deliveryAddress: order?.deliveryAddress ?? "",
          deliveryNotes: order?.deliveryNotes ?? "",
          internalNotes: order?.internalNotes ?? "",
        }}
      />
    </>
  );
}
