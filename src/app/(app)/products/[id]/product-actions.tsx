"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Archive, ArchiveRestore, PackagePlus, Pencil, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { MoneyField, SelectField, SwitchField, TextField } from "@/components/app/form-fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { useServerAction } from "@/hooks/use-server-action";
import { adjustStockSchema, archiveProductSchema, restockSchema } from "@/lib/validation/products";
import {
  adjustStockAction,
  archiveProductAction,
  reactivateProductAction,
  restockProductAction,
} from "@/server/actions/products";

interface ProductActionsProps {
  product: { id: string; name: string; status: string; quantity: number; costPriceInput: string | null };
  canManage: boolean;
  canAdjust: boolean;
}

type Dialogs = "adjust" | "restock" | "archive" | null;

export function ProductActions({ product, canManage, canAdjust }: ProductActionsProps) {
  const [open, setOpen] = useState<Dialogs>(null);
  const router = useRouter();
  const reactivate = useServerAction(reactivateProductAction, {
    successMessage: ({ status }) => (status === "ACTIVE" ? "Back in the catalogue" : "Reactivated — restock to sell it again"),
    onSuccess: () => router.refresh(),
  });
  const isArchived = product.status === "ARCHIVED" || product.status === "DISCONTINUED";
  const close = () => setOpen(null);

  return (
    <>
      {canManage && (
        <Button asChild variant="outline">
          <Link href={`/products/${product.id}/edit`}>
            <Pencil aria-hidden /> Edit
          </Link>
        </Button>
      )}
      {canAdjust && (
        <Button variant="outline" onClick={() => setOpen("adjust")}>
          <SlidersHorizontal aria-hidden /> Adjust stock
        </Button>
      )}
      {canAdjust && (
        <Button onClick={() => setOpen("restock")}>
          <PackagePlus aria-hidden /> {product.status === "ACTIVE" ? "Restock" : "Restock & reactivate"}
        </Button>
      )}
      {canManage && !isArchived && (
        <Button variant="ghost" onClick={() => setOpen("archive")}>
          <Archive aria-hidden /> Archive
        </Button>
      )}
      {canManage && isArchived && (
        <Button variant="ghost" disabled={reactivate.isPending} onClick={() => reactivate.run(product.id)}>
          <ArchiveRestore aria-hidden /> Reactivate
        </Button>
      )}
      {open === "adjust" && <AdjustDialog product={product} onClose={close} />}
      {open === "restock" && <RestockDialog product={product} onClose={close} />}
      {open === "archive" && <ArchiveDialog product={product} onClose={close} />}
    </>
  );
}

function AdjustDialog({ product, onClose }: { product: ProductActionsProps["product"]; onClose: () => void }) {
  const router = useRouter();
  const form = useForm<z.input<typeof adjustStockSchema>>({
    resolver: zodResolver(adjustStockSchema),
    defaultValues: { productId: product.id, kind: "DAMAGE", direction: "decrease", quantity: 1, reason: "" },
  });
  const kind = form.watch("kind");
  const { run, isPending } = useServerAction(adjustStockAction, {
    successMessage: ({ newQuantity }) => `Stock is now ${newQuantity}`,
    setError: form.setError,
    onSuccess: () => {
      onClose();
      router.refresh();
    },
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adjust stock — {product.name}</DialogTitle>
          <DialogDescription>Currently {product.quantity} in stock. Every adjustment is written to the stock ledger.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((v) => run(v))} noValidate>
          <FieldGroup>
            <SelectField
              control={form.control}
              name="kind"
              label="Type"
              options={[
                { value: "DAMAGE", label: "Damaged goods (removes stock)" },
                { value: "LOSS", label: "Lost / stolen (removes stock)" },
                { value: "MANUAL_ADJUSTMENT", label: "Stock count correction" },
              ]}
            />
            {kind === "MANUAL_ADJUSTMENT" && (
              <SelectField
                control={form.control}
                name="direction"
                label="Direction"
                options={[
                  { value: "increase", label: "Add units" },
                  { value: "decrease", label: "Remove units" },
                ]}
              />
            )}
            <TextField control={form.control} name="quantity" label="Quantity" inputMode="numeric" />
            <TextField control={form.control} name="reason" label="Reason" placeholder="e.g. Cracked during display" />
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Record adjustment"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RestockDialog({ product, onClose }: { product: ProductActionsProps["product"]; onClose: () => void }) {
  const router = useRouter();
  const form = useForm<z.input<typeof restockSchema>>({
    resolver: zodResolver(restockSchema),
    defaultValues: { productId: product.id, quantity: 1, unitCost: product.costPriceInput ?? "", reason: "" },
  });
  const { run, isPending } = useServerAction(restockProductAction, {
    successMessage: ({ newQuantity }) => `Restocked — ${newQuantity} now in stock`,
    setError: form.setError,
    onSuccess: () => {
      onClose();
      router.refresh();
    },
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Restock {product.name}</DialogTitle>
          <DialogDescription>
            Adds stock to this existing product (no duplicate is created) and returns it to the POS. The cost price becomes
            the weighted average. For supplier invoices, use Purchases instead.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((v) => run(v))} noValidate>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="quantity" label="Quantity received" inputMode="numeric" />
              <MoneyField control={form.control} name="unitCost" label="Unit cost (GH₵)" />
            </div>
            <TextField control={form.control} name="reason" label="Note (optional)" />
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Restock"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveDialog({ product, onClose }: { product: ProductActionsProps["product"]; onClose: () => void }) {
  const router = useRouter();
  const form = useForm<z.input<typeof archiveProductSchema>>({
    resolver: zodResolver(archiveProductSchema),
    defaultValues: { id: product.id, reason: "", discontinue: false },
  });
  const { run, isPending } = useServerAction(archiveProductAction, {
    successMessage: "Removed from the catalogue",
    setError: form.setError,
    onSuccess: () => {
      onClose();
      router.refresh();
    },
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Archive {product.name}?</DialogTitle>
          <DialogDescription>
            It disappears from the POS but its sales, stock movements and profit history are kept. You can reactivate it any time.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((v) => run(v))} noValidate>
          <FieldGroup>
            <TextField control={form.control} name="reason" label="Reason" placeholder="e.g. End of season" />
            <SwitchField control={form.control} name="discontinue" label="Discontinued" description="We will not stock this product again." />
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={isPending}>{isPending ? "Archiving…" : "Archive product"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
