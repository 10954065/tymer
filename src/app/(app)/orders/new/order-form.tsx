"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { MoneyField, SelectField, TextAreaField, TextField } from "@/components/app/form-fields";
import { ProductPicker } from "@/components/app/product-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useServerAction } from "@/hooks/use-server-action";
import { formatMoney, toMoneyInput, tryParseMoney } from "@/lib/money";
import { orderSchema, type OrderFormValues } from "@/lib/validation/orders";
import { createOrderAction, updateOrderAction } from "@/server/actions/orders";
import { CustomerPicker, type PickedCustomer } from "../../pos/customer-picker";

interface OrderFormProps {
  products: { id: string; name: string; sku: string; sellingPrice: number }[];
  defaults: OrderFormValues;
  initialCustomer: PickedCustomer | null;
  orderId?: string;
}

export function OrderForm({ products, defaults, initialCustomer, orderId }: OrderFormProps) {
  const router = useRouter();
  const [customer, setCustomer] = useState<PickedCustomer | null>(initialCustomer);
  const form = useForm<OrderFormValues>({ resolver: zodResolver(orderSchema), defaultValues: defaults });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "items" });
  const items = useWatch({ control: form.control, name: "items" }) ?? [];
  const fulfilment = useWatch({ control: form.control, name: "fulfilment" });
  const total = items.reduce((s, i) => s + (tryParseMoney(String(i.unitPrice ?? "")) ?? 0) * (Number(i.quantity) || 0), 0);
  const options = products.map((p) => ({ id: p.id, label: p.name, hint: p.sku }));
  const action = orderId ? updateOrderAction : createOrderAction;
  const { run, isPending } = useServerAction(action, {
    successMessage: orderId ? "Order updated" : "Order created",
    setError: form.setError,
    onSuccess: ({ id }) => router.push(`/orders/${id}`),
  });

  return (
    <form onSubmit={form.handleSubmit((v) => run({ ...v, ...(orderId ? { id: orderId } : {}) }))} noValidate className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <Card className="surface-elevated">
          <CardHeader><CardTitle>Customer & job</CardTitle></CardHeader>
          <CardContent>
            <FieldGroup>
              <div className="grid gap-2">
                <FieldLabel>Customer</FieldLabel>
                <CustomerPicker value={customer} canCreate onChange={(c) => { setCustomer(c); form.setValue("customerId", c?.id ?? "", { shouldValidate: true }); }} />
                {form.formState.errors.customerId && <FieldError errors={[form.formState.errors.customerId]} />}
              </div>
              <TextField control={form.control} name="title" label="Order title" placeholder="e.g. Bedroom curtains and cushions" />
              <TextAreaField control={form.control} name="description" label="What the customer wants" rows={3} />
            </FieldGroup>
          </CardContent>
        </Card>
        <Card className="surface-elevated">
          <CardHeader><CardTitle>Products & services</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {fields.map((field, index) => {
              const kind = items[index]?.kind ?? "SERVICE";
              return (
                <div key={field.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[110px_1fr_80px_120px_auto] sm:items-start">
                  <select aria-label="Line type" className="h-9 rounded-md border bg-background px-2 text-sm" {...form.register(`items.${index}.kind`)}>
                    <option value="SERVICE">Service</option>
                    <option value="PRODUCT">Stock item</option>
                  </select>
                  {kind === "PRODUCT" ? (
                    <Controller control={form.control} name={`items.${index}.productId`} render={({ field: f, fieldState }) => (
                      <div>
                        <ProductPicker options={options} value={f.value ?? ""} invalid={fieldState.invalid} onChange={(id) => {
                          f.onChange(id);
                          const p = products.find((x) => x.id === id);
                          if (p) {
                            form.setValue(`items.${index}.description`, p.name);
                            form.setValue(`items.${index}.unitPrice`, toMoneyInput(p.sellingPrice));
                          }
                        }} />
                        {fieldState.error && <FieldError errors={[fieldState.error]} />}
                      </div>
                    )} />
                  ) : (
                    <Input aria-label="Service description" placeholder="e.g. Installation" {...form.register(`items.${index}.description`)} />
                  )}
                  <Input aria-label="Quantity" inputMode="numeric" {...form.register(`items.${index}.quantity`)} />
                  <Input aria-label="Unit price (GH₵)" inputMode="decimal" placeholder="Price" className="tabular-nums" {...form.register(`items.${index}.unitPrice`)} />
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove line" disabled={fields.length === 1} onClick={() => remove(index)}><Trash2 aria-hidden /></Button>
                </div>
              );
            })}
            <Button type="button" variant="outline" size="sm" onClick={() => append({ kind: "SERVICE", productId: null, description: "", quantity: 1, unitPrice: "" })}>
              <Plus aria-hidden /> Add line
            </Button>
          </CardContent>
        </Card>
      </div>
      <div className="grid content-start gap-4">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">Agreed price</p>
          <p className="font-heading text-3xl font-semibold tabular-nums">{formatMoney(total)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Revenue is recognised when the order is completed. Deposits are recorded as payments.</p>
        </div>
        <Card className="surface-elevated">
          <CardContent>
            <FieldGroup>
              <div className="grid grid-cols-2 gap-3">
                <MoneyField control={form.control} name="estimatedMaterialsCost" label="Est. materials" />
                <MoneyField control={form.control} name="estimatedLabourCost" label="Est. labour" />
              </div>
              <TextField control={form.control} name="expectedCompletionDate" label="Expected completion" type="date" />
              <SelectField control={form.control} name="fulfilment" label="Collection or delivery" options={[{ value: "COLLECTION", label: "Customer collects" }, { value: "DELIVERY", label: "We deliver" }]} />
              {fulfilment === "DELIVERY" && <TextAreaField control={form.control} name="deliveryAddress" label="Delivery address" rows={2} />}
              <TextAreaField control={form.control} name="internalNotes" label="Internal notes" rows={2} />
            </FieldGroup>
          </CardContent>
        </Card>
        <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : orderId ? "Save changes" : "Create order"}</Button>
      </div>
    </form>
  );
}
