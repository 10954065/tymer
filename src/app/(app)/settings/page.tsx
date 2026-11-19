import type { Metadata } from "next";
import { Database } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { toMoneyInput } from "@/lib/money";
import { requirePagePermission } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { getSettings } from "@/server/services/settings";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requirePagePermission("settings:manage");
  const settings = await getSettings(getDb());

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Business settings"
        description="Details printed on receipts and the rules applied at checkout. Every change is recorded in the audit log."
        actions={
          <Button asChild variant="outline">
            <Link href="/settings/database">
              <Database aria-hidden /> Database health & backups
            </Link>
          </Button>
        }
      />
      <SettingsForm
        defaults={{
          businessName: settings.businessName,
          address: settings.address ?? "",
          phone: settings.phone ?? "",
          email: settings.email ?? "",
          receiptFooter: settings.receiptFooter ?? "",
          allowNegativeStock: settings.allowNegativeStock,
          defaultReorderThreshold: settings.defaultReorderThreshold,
          // Basis points and pesewas are both hundredths, so the money input formatter renders "12.50".
          cashierMaxDiscountPercent: toMoneyInput(settings.cashierMaxDiscountBps),
          taxRatePercent: toMoneyInput(settings.taxRateBps),
          taxLabel: settings.taxLabel ?? "",
        }}
      />
    </>
  );
}
