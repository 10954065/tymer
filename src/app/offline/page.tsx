import { WifiOff } from "lucide-react";
import Link from "next/link";

export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="grid min-h-svh place-items-center bg-background p-6 text-center">
      <div className="max-w-sm space-y-3">
        <WifiOff className="mx-auto size-10 text-muted-foreground" aria-hidden />
        <h1 className="font-heading text-2xl font-semibold">You are offline</h1>
        <p className="text-sm text-muted-foreground">
          This page has not been saved on this device yet. The POS keeps working offline once it has been opened online at
          least once — sales are stored safely and sync automatically when the connection returns.
        </p>
        <Link href="/pos" className="inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Open the POS</Link>
      </div>
    </main>
  );
}
