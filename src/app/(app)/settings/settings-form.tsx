"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { SwitchField, TextAreaField, TextField } from "@/components/app/form-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { useServerAction } from "@/hooks/use-server-action";
import { settingsSchema, type SettingsFormValues } from "@/lib/validation/settings";
import { updateSettingsAction } from "@/server/actions/settings";

export function SettingsForm({ defaults }: { defaults: SettingsFormValues }) {
  const router = useRouter();
  const form = useForm<SettingsFormValues>({ resolver: zodResolver(settingsSchema), defaultValues: defaults });
  const { run, isPending } = useServerAction(updateSettingsAction, {
    successMessage: "Settings saved",
    setError: form.setError,
    onSuccess: () => router.refresh(),
  });

  return (
    <form onSubmit={form.handleSubmit(() => run(form.getValues()))} noValidate className="grid gap-6 lg:grid-cols-2">
      <Card className="surface-elevated">
        <CardHeader>
          <CardTitle>Business details</CardTitle>
          <CardDescription>Shown on receipts and exported reports.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <TextField control={form.control} name="businessName" label="Business name" />
            <TextAreaField control={form.control} name="address" label="Address" rows={2} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="phone" label="Phone" inputMode="tel" />
              <TextField control={form.control} name="email" label="Email" type="email" />
            </div>
            <TextAreaField control={form.control} name="receiptFooter" label="Receipt footer" rows={2} />
          </FieldGroup>
        </CardContent>
      </Card>
      <Card className="surface-elevated">
        <CardHeader>
          <CardTitle>Checkout & stock rules</CardTitle>
          <CardDescription>Applied on the server to every sale.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="taxRatePercent" label="Sales tax rate (%)" inputMode="decimal"
                description="0 if prices already include tax or you are not VAT-registered." />
              <TextField control={form.control} name="taxLabel" label="Tax label" placeholder="VAT" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="cashierMaxDiscountPercent" label="Cashier discount limit (%)" inputMode="decimal"
                description="Larger discounts need a manager or owner." />
              <TextField control={form.control} name="defaultReorderThreshold" label="Default reorder level" inputMode="numeric"
                description="Used for new products." />
            </div>
            <SwitchField control={form.control} name="allowNegativeStock" label="Allow selling below zero stock"
              description="Off by default. When on, sales may exceed recorded stock (the shortfall is recorded)." />
          </FieldGroup>
        </CardContent>
      </Card>
      <div className="lg:col-span-2">
        <Button type="submit" disabled={isPending || !form.formState.isDirty}>
          {isPending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
