"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { FolderPlus, Pencil } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { SwitchField, TextAreaField, TextField } from "@/components/app/form-fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { useServerAction } from "@/hooks/use-server-action";
import { updateCategorySchema } from "@/lib/validation/products";
import { createCategoryAction, updateCategoryAction } from "@/server/actions/products";

type Values = z.input<typeof updateCategorySchema>;
// Placeholder id so the shared schema validates while creating; the create action ignores it.
const NEW_ID = "00000000-0000-4000-8000-000000000000";

export function CategoryDialog({ category }: { category?: { id: string; name: string; description: string | null; isActive: boolean } }) {
  const [open, setOpen] = useState(false);
  const isEdit = Boolean(category);
  const defaults: Values = {
    id: category?.id ?? NEW_ID,
    name: category?.name ?? "",
    description: category?.description ?? "",
    isActive: category?.isActive ?? true,
  };
  const form = useForm<Values>({ resolver: zodResolver(updateCategorySchema), defaultValues: defaults });
  const create = useServerAction(createCategoryAction, { successMessage: "Category added", setError: form.setError });
  const update = useServerAction(updateCategoryAction, { successMessage: "Category updated", setError: form.setError });
  const isPending = create.isPending || update.isPending;

  async function submit(values: Values) {
    const result = isEdit ? await update.run(values) : await create.run({ name: values.name, description: values.description });
    if (result.ok) {
      setOpen(false);
      if (!isEdit) form.reset(defaults);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {isEdit ? (
          <Button variant="ghost" size="icon" aria-label={`Edit ${category?.name}`}><Pencil aria-hidden /></Button>
        ) : (
          <Button><FolderPlus aria-hidden /> Add category</Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit category" : "New category"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(submit)} noValidate>
          <FieldGroup>
            <TextField control={form.control} name="name" label="Name" placeholder="e.g. Vases & urns" />
            <TextAreaField control={form.control} name="description" label="Description (optional)" rows={2} />
            {isEdit && <SwitchField control={form.control} name="isActive" label="Active" description="Inactive categories are hidden from new products." />}
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
