"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { SelectField, SwitchField, TextAreaField, TextField } from "@/components/app/form-fields";
import { ProductPicker } from "@/components/app/product-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useServerAction } from "@/hooks/use-server-action";
import { formatMoney, toMoneyInput, tryParseMoney } from "@/lib/money";
import { purchaseSchema, type PurchaseFormValues } from "@/lib/validation/purchases";
import { createPurchaseAction } from "@/server/actions/purchases";

interface PurchaseFormProps {
  suppliers: { id: string; name: string }[];
  products: { id: string; name: string; sku: string; costPrice: number }[];
  today: string;
  defaultSupplierId?: string;
}

export function PurchaseForm({ suppliers, products, today, defaultSupplierId }: PurchaseFormProps) {
  const router = useRouter();
  const form = useForm<PurchaseFormValues>({
    resolver: zodResolver(purchaseSchema),
    defaultValues: {
      supplierId: defaultSupplierId ?? "",
      purchaseDate: today,
      supplierReference: "",
      notes: "",
      items: [{ productId: "", quantity: 1, unitCost: "" }],
      receiveNow: true,
    },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "items" });
  const items = useWatch({ control: form.control, name: "items" });
  const total = (items ?? []).reduce((sum, item) => sum + (tryParseMoney(String(item.unitCost ?? "")) ?? 0) * (Number(item.quantity) || 0), 0);
  const productOptions = products.map((p) => ({ id: p.id, label: p.name, hint: p.sku }));
  const { run, isPending } = useServerAction(createPurchaseAction, {
    successMessage: "Purchase saved",
    setError: form.setError,
    onSuccess: ({ id }) => router.push(`/purchases/${id}`),
  });

  return (
    <form onSubmit={form.handleSubmit((v) => run(v))} noValidate className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card className="surface-elevated">
        <CardHeader><CardTitle>Items received</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {fields.map((field, index) => (
            <div key={field.id} className="grid grid-cols-[1fr_auto] gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_90px_130px_auto] sm:items-start">
              <Controller
                control={form.control}
                name={`items.${index}.productId`}
                render={({ field: f, fieldState }) => (
                  <div className="col-span-2 sm:col-span-1">
                    <ProductPicker
                      options={productOptions}
                      value={f.value}
                      invalid={fieldState.invalid}
                      onChange={(id) => {
                        f.onChange(id);
                        const product = products.find((p) => p.id === id);
                        if (product && !form.getValues(`items.${index}.unitCost`)) {
                          form.setValue(`items.${index}.unitCost`, toMoneyInput(product.costPrice));
                        }
                      }}
                    />
                    {fieldState.error && <FieldError errors={[fieldState.error]} />}
                  </div>
                )}
              />
              <Input aria-label="Quantity" inputMode="numeric" {...form.register(`items.${index}.quantity`)} />
              <Input aria-label="Unit cost (GH₵)" inputMode="decimal" placeholder="Unit cost" className="tabular-nums" {...form.register(`items.${index}.unitCost`)} />
              <Button type="button" variant="ghost" size="icon" aria-label="Remove line" disabled={fields.length === 1} onClick={() => remove(index)}>
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => append({ productId: "", quantity: 1, unitCost: "" })}>
            <Plus aria-hidden /> Add line
          </Button>
          {form.formState.errors.items?.root && <FieldError errors={[form.formState.errors.items.root]} />}
        </CardContent>
      </Card>
      <div className="grid content-start gap-4">
        <Card className="surface-elevated">
          <CardContent>
            <FieldGroup>
              <SelectField control={form.control} name="supplierId" label="Supplier" options={suppliers.map((s) => ({ value: s.id, label: s.name }))} placeholder="Choose supplier" />
              <TextField control={form.control} name="purchaseDate" label="Purchase date" type="date" />
              <TextField control={form.control} name="supplierReference" label="Supplier invoice no. (optional)" />
              <TextAreaField control={form.control} name="notes" label="Notes" rows={2} />
              <SwitchField control={form.control} name="receiveNow" label="Goods received now" description="Adds the stock immediately. Turn off to record an order still on its way." />
            </FieldGroup>
          </CardContent>
        </Card>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">Purchase total</p>
          <p className="font-heading text-2xl font-semibold tabular-nums">{formatMoney(total)}</p>
        </div>
        <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Save purchase"}</Button>
      </div>
    </form>
  );
}
