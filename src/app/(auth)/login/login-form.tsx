"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { TextField } from "@/components/app/form-fields";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { useServerAction } from "@/hooks/use-server-action";
import { loginSchema } from "@/lib/validation/users";
import { loginAction } from "@/server/actions/auth";

type LoginValues = z.input<typeof loginSchema>;

export function LoginForm({ nextPath }: { nextPath: string | null }) {
  const router = useRouter();
  const form = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { username: "", password: "" } });
  const { run, isPending } = useServerAction(loginAction, {
    onSuccess: ({ redirectTo }) => {
      router.replace(redirectTo.startsWith("/account") ? redirectTo : (nextPath ?? redirectTo));
      router.refresh();
    },
  });

  return (
    <form onSubmit={form.handleSubmit((values) => run(values))} noValidate>
      <FieldGroup>
        <TextField control={form.control} name="username" label="Username" autoComplete="username" autoCapitalize="none" autoFocus />
        <TextField control={form.control} name="password" label="Password" type="password" autoComplete="current-password" />
        <Button type="submit" size="lg" className="h-10 w-full" disabled={isPending}>
          {isPending && <Loader2 className="animate-spin" aria-hidden />}
          {isPending ? "Signing in…" : "Sign in"}
        </Button>
      </FieldGroup>
    </form>
  );
}
