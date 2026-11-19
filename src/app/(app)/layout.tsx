import { AppShell } from "@/components/app/app-shell";
import { navigationFor } from "@/lib/navigation";
import { requireSession } from "@/server/auth/current-user";
import { getCachedSettings } from "@/server/queries/settings";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await requireSession();
  const settings = await getCachedSettings();
  const { fullName, username, role } = session.user;

  return (
    <AppShell navigation={navigationFor(role)} user={{ fullName, username, role }} businessName={settings.businessName}>
      {children}
    </AppShell>
  );
}
