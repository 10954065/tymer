"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Controller, useForm, type Resolver } from "react-hook-form";
import { MoneyField, SelectField, TextAreaField, TextField } from "@/components/app/form-fields";
import { ImageUpload } from "@/components/app/image-upload";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { useServerAction } from "@/hooks/use-server-action";
import {
  createProductSchema,
  updateProductSchema,
  type CreateProductValues,
  type UpdateProductValues,
} from "@/lib/validation/products";
import { createProductAction, updateProductAction } from "@/server/actions/products";

type Option = { id: string; name: string };
type FormValues = Partial<UpdateProductValues> & CreateProductValues;
const NONE = "__none__";

interface ProductFormProps {
  mode: "create" | "edit";
  defaults: CreateProductValues | UpdateProductValues;
  categories: Option[];
  suppliers: Option[];
  canViewCost: boolean;
}

export function ProductForm({ mode, defaults, categories, suppliers, canViewCost }: ProductFormProps) {
  const router = useRouter();
  const schema = mode === "create" ? createProductSchema : updateProductSchema;
  // One form type for both modes; each mode validates with its own schema.
  const form = useForm<FormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<FormValues>,
    defaultValues: defaults as FormValues,
  });
  const action = mode === "create" ? createProductAction : updateProductAction;
  const { run, isPending } = useServerAction(action, {
    successMessage: mode === "create" ? "Product created" : "Product updated",
    setError: form.setError,
    onSuccess: ({ id }) => {
      router.push(`/products/${id}`);
      router.refresh();
    },
  });

  const toOptions = (items: Option[], emptyLabel: string) => [
    { value: NONE, label: emptyLabel },
    ...items.map((item) => ({ value: item.id, label: item.name })),
  ];

  function submit(values: FormValues) {
    run({
      ...values,
      categoryId: values.categoryId === NONE ? null : values.categoryId,
      supplierId: values.supplierId === NONE ? null : values.supplierId,
    });
  }

  return (
    <form onSubmit={form.handleSubmit(submit)} noValidate className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      <Card className="surface-elevated">
        <CardHeader>
          <CardTitle>Product details</CardTitle>
          <CardDescription>Leave SKU empty to generate one automatically.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <TextField control={form.control} name="name" label="Product name" autoFocus={mode === "create"} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="sku" label="SKU" autoCapitalize="characters" />
              <TextField control={form.control} name="barcode" label="Barcode (optional)" inputMode="numeric" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField control={form.control} name="categoryId" label="Category" options={toOptions(categories, "No category")} />
              <SelectField control={form.control} name="supplierId" label="Supplier" options={toOptions(suppliers, "No supplier")} />
            </div>
            <TextAreaField control={form.control} name="description" label="Description" rows={3} />
            <Controller
              control={form.control}
              name="imageKey"
              render={({ field }) => <ImageUpload value={field.value ?? null} onChange={field.onChange} />}
            />
          </FieldGroup>
        </CardContent>
      </Card>

      <div className="grid content-start gap-6">
        <Card className="surface-elevated">
          <CardHeader>
            <CardTitle>Pricing & stock</CardTitle>
            <CardDescription>
              {mode === "create"
                ? "Opening stock is recorded in the stock ledger at the cost price."
                : "Quantities change only through stock movements, never by editing."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <MoneyField control={form.control} name="sellingPrice" label="Selling price (GH₵)" />
                {canViewCost && <MoneyField control={form.control} name="costPrice" label="Cost price (GH₵)" />}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {mode === "create" && (
                  <TextField control={form.control} name="initialStock" label="Opening stock" inputMode="numeric" />
                )}
                <TextField control={form.control} name="reorderThreshold" label="Reorder level" inputMode="numeric" />
              </div>
              {mode === "edit" && (
                <TextField control={form.control} name="priceChangeReason" label="Reason for price change (optional)"
                  description="Saved in the price history when prices change." />
              )}
            </FieldGroup>
          </CardContent>
        </Card>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : mode === "create" ? "Create product" : "Save changes"}
          </Button>
        </div>
      </div>
    </form>
  );
}

export const PRODUCT_FORM_NONE = NONE;
