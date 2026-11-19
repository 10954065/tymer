"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Paperclip, Plus, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { MoneyField, SelectField, TextAreaField, TextField } from "@/components/app/form-fields";
import { ReasonDialog } from "@/components/app/money-dialogs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { useServerAction } from "@/hooks/use-server-action";
import { compressImage, uploadFile } from "@/lib/client/image";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/lib/validation/common";
import { expenseSchema, type ExpenseFormValues } from "@/lib/validation/expenses";
import { correctExpenseAction, createExpenseAction } from "@/server/actions/expenses";

interface Options {
  categories: { id: string; name: string }[];
  orders: { id: string; label: string }[];
  today: string;
}

export function NewExpenseDialog({ categories, orders, today }: Options) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const defaults: ExpenseFormValues = { description: "", amount: "", categoryId: "", expenseDate: today, paymentMethod: "CASH", orderId: "__none__", attachmentKey: null, notes: "" };
  const form = useForm<ExpenseFormValues>({ resolver: zodResolver(expenseSchema), defaultValues: defaults });
  const attachment = form.watch("attachmentKey");
  const { run, isPending } = useServerAction(createExpenseAction, {
    successMessage: "Expense recorded",
    setError: form.setError,
    onSuccess: () => { form.reset(defaults); setOpen(false); router.refresh(); },
  });

  async function attach(file: File) {
    setUploading(true);
    try {
      const blob = file.type.startsWith("image/") ? await compressImage(file, 1400, 0.75) : file;
      form.setValue("attachmentKey", await uploadFile(blob, "expenses", file.name));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus aria-hidden /> Record expense</Button></DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record an expense</DialogTitle>
          <DialogDescription>Stock bought for resale is a Purchase, not an expense.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((v) => run(v))} noValidate>
          <FieldGroup>
            <TextField control={form.control} name="description" label="Description" />
            <div className="grid gap-4 sm:grid-cols-2">
              <MoneyField control={form.control} name="amount" label="Amount (GH₵)" />
              <TextField control={form.control} name="expenseDate" label="Date" type="date" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField control={form.control} name="categoryId" label="Category" options={categories.map((c) => ({ value: c.id, label: c.name }))} />
              <SelectField control={form.control} name="paymentMethod" label="Paid with" options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))} />
            </div>
            <SelectField control={form.control} name="orderId" label="For a customer order? (direct cost)" options={[{ value: "__none__", label: "No — general business expense" }, ...orders.map((o) => ({ value: o.id, label: o.label }))]} />
            <TextAreaField control={form.control} name="notes" label="Notes" rows={2} />
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <Paperclip className="size-4" aria-hidden /> {uploading ? "Uploading…" : attachment ? "Receipt attached ✓" : "Attach receipt photo or PDF (optional)"}
              <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => e.target.files?.[0] && attach(e.target.files[0])} />
            </label>
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending || uploading}>Save expense</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CorrectExpenseButton({ expenseId }: { expenseId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}><Undo2 aria-hidden /> Reverse</Button>
      {open && (
        <ReasonDialog
          title="Reverse this expense?"
          description="A negative entry on the same date cancels it out; the original stays visible. Record the correct expense afterwards if needed."
          confirmLabel="Reverse expense"
          destructive
          onClose={() => setOpen(false)}
          onConfirm={async (reason) => {
            const r = await correctExpenseAction({ expenseId, reason, replacement: null });
            if (r.ok) { toast.success("Expense reversed"); router.refresh(); } else toast.error(r.error);
            return r.ok;
          }}
        />
      )}
    </>
  );
}
