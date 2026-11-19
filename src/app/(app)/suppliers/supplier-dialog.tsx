"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { SwitchField, TextAreaField, TextField } from "@/components/app/form-fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { useServerAction } from "@/hooks/use-server-action";
import { updateSupplierSchema } from "@/lib/validation/purchases";
import { createSupplierAction, updateSupplierAction } from "@/server/actions/purchases";

type Values = z.input<typeof updateSupplierSchema>;
// Placeholder id so the shared schema validates while creating; the create action ignores it.
const NEW_ID = "00000000-0000-4000-8000-000000000000";

export interface SupplierFormData {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
}

export function SupplierDialog({ supplier }: { supplier?: SupplierFormData }) {
  const [open, setOpen] = useState(false);
  const isEdit = Boolean(supplier);
  const defaults: Values = {
    id: supplier?.id ?? NEW_ID,
    name: supplier?.name ?? "",
    contactPerson: supplier?.contactPerson ?? "",
    phone: supplier?.phone ?? "",
    email: supplier?.email ?? "",
    address: supplier?.address ?? "",
    notes: supplier?.notes ?? "",
    isActive: supplier?.isActive ?? true,
  };
  const form = useForm<Values>({ resolver: zodResolver(updateSupplierSchema), defaultValues: defaults });
  const create = useServerAction(createSupplierAction, { successMessage: "Supplier added", setError: form.setError });
  const update = useServerAction(updateSupplierAction, { successMessage: "Supplier updated", setError: form.setError });

  async function submit(values: Values) {
    const { id: _id, isActive: _active, ...fields } = values;
    const result = isEdit ? await update.run(values) : await create.run(fields);
    if (result.ok) {
      setOpen(false);
      if (!isEdit) form.reset(defaults);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {isEdit ? (
          <Button variant="ghost" size="icon" aria-label={`Edit ${supplier?.name}`}><Pencil aria-hidden /></Button>
        ) : (
          <Button><Plus aria-hidden /> Add supplier</Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{isEdit ? "Edit supplier" : "New supplier"}</DialogTitle></DialogHeader>
        <form onSubmit={form.handleSubmit(submit)} noValidate>
          <FieldGroup>
            <TextField control={form.control} name="name" label="Business name" />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="contactPerson" label="Contact person" />
              <TextField control={form.control} name="phone" label="Phone" inputMode="tel" />
            </div>
            <TextField control={form.control} name="email" label="Email" type="email" />
            <TextAreaField control={form.control} name="address" label="Address" rows={2} />
            <TextAreaField control={form.control} name="notes" label="Notes" rows={2} />
            {isEdit && <SwitchField control={form.control} name="isActive" label="Active supplier" />}
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || update.isPending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
