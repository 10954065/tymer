"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { SwitchField, TextAreaField, TextField } from "@/components/app/form-fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { useServerAction } from "@/hooks/use-server-action";
import { updateCustomerSchema } from "@/lib/validation/sales";
import { createCustomerAction, updateCustomerAction } from "@/server/actions/sales";

type Values = z.input<typeof updateCustomerSchema>;
// Placeholder id so the shared schema validates while creating; the create action ignores it.
const NEW_ID = "00000000-0000-4000-8000-000000000000";

export function CustomerDialog({ customer }: { customer?: { id: string; fullName: string; phone: string | null; email: string | null; address: string | null; notes: string | null; isActive: boolean } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const isEdit = Boolean(customer);
  const defaults: Values = {
    id: customer?.id ?? NEW_ID,
    fullName: customer?.fullName ?? "",
    phone: customer?.phone ?? "",
    email: customer?.email ?? "",
    address: customer?.address ?? "",
    notes: customer?.notes ?? "",
    isActive: customer?.isActive ?? true,
  };
  const form = useForm<Values>({ resolver: zodResolver(updateCustomerSchema), defaultValues: defaults });
  const create = useServerAction(createCustomerAction, { successMessage: "Customer added", setError: form.setError });
  const update = useServerAction(updateCustomerAction, { successMessage: "Customer updated", setError: form.setError });

  async function submit(values: Values) {
    const { id: _id, isActive: _active, ...fields } = values;
    const result = isEdit ? await update.run(values) : await create.run(fields);
    if (result.ok) {
      setOpen(false);
      if (!isEdit) form.reset(defaults);
      router.refresh();
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {isEdit ? <Button variant="outline"><Pencil aria-hidden /> Edit</Button> : <Button><UserPlus aria-hidden /> Add customer</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{isEdit ? "Edit customer" : "New customer"}</DialogTitle></DialogHeader>
        <form onSubmit={form.handleSubmit(submit)} noValidate>
          <FieldGroup>
            <TextField control={form.control} name="fullName" label="Full name" />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="phone" label="Phone" inputMode="tel" />
              <TextField control={form.control} name="email" label="Email" type="email" />
            </div>
            <TextAreaField control={form.control} name="address" label="Address" rows={2} />
            <TextAreaField control={form.control} name="notes" label="Notes (preferences, style, sizes…)" rows={2} />
            {isEdit && <SwitchField control={form.control} name="isActive" label="Active" />}
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
