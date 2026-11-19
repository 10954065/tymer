import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROLE_LABELS } from "@/lib/permissions";
import { requireSession } from "@/server/auth/current-user";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "My account" };

export default async function AccountPage() {
  const { user } = await requireSession();
  return (
    <div className="max-w-2xl">
      <PageHeader title="My account" description={`${user.fullName} · @${user.username} · ${ROLE_LABELS[user.role]}`} />
      {user.mustChangePassword && (
        <Alert className="mb-6 border-warning/50 bg-warning/10">
          <ShieldAlert aria-hidden />
          <AlertTitle>Please set a new password</AlertTitle>
          <AlertDescription>Your password was set by an administrator. Choose your own before continuing.</AlertDescription>
        </Alert>
      )}
      <Card className="surface-elevated">
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>At least 8 characters with letters and numbers. Other devices will be signed out.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
