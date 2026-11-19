"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { TextField } from "@/components/app/form-fields";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { useServerAction } from "@/hooks/use-server-action";
import { changePasswordSchema } from "@/lib/validation/users";
import { changePasswordAction } from "@/server/actions/auth";

type Values = z.input<typeof changePasswordSchema>;

export function ChangePasswordForm() {
  const router = useRouter();
  const form = useForm<Values>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });
  const { run, isPending } = useServerAction(changePasswordAction, {
    successMessage: "Password updated",
    setError: form.setError,
    onSuccess: ({ redirectTo }) => {
      form.reset();
      router.replace(redirectTo);
      router.refresh();
    },
  });

  return (
    <form onSubmit={form.handleSubmit((values) => run(values))} noValidate>
      <FieldGroup>
        <TextField control={form.control} name="currentPassword" label="Current password" type="password" autoComplete="current-password" />
        <TextField control={form.control} name="newPassword" label="New password" type="password" autoComplete="new-password" />
        <TextField control={form.control} name="confirmPassword" label="Confirm new password" type="password" autoComplete="new-password" />
        <Button type="submit" disabled={isPending} className="w-fit">
          {isPending ? "Saving…" : "Update password"}
        </Button>
      </FieldGroup>
    </form>
  );
}
