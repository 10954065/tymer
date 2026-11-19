import { ShieldOff } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { homePathFor } from "@/lib/permissions";
import { requireSession } from "@/server/auth/current-user";

export default async function NoAccessPage() {
  const session = await requireSession();
  return (
    <EmptyState
      icon={ShieldOff}
      title="You don't have access to this page"
      description="Your role does not include this area. Ask the shop owner if you need access."
      action={
        <Button asChild>
          <Link href={homePathFor(session.user.role)}>Go to my home page</Link>
        </Button>
      }
      className="mt-10"
    />
  );
}
