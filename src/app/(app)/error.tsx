"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto mt-10 max-w-lg rounded-xl border border-destructive/30 bg-card p-8 text-center">
      <span className="mx-auto mb-4 grid size-11 place-items-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-5" aria-hidden />
      </span>
      <h2 className="font-heading text-xl font-semibold">This page could not be loaded</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Nothing was changed. If you are offline, reconnect and try again.
        {error.digest && <span className="mt-2 block font-mono text-xs">Reference: {error.digest}</span>}
      </p>
      <Button className="mt-6" onClick={reset}>
        <RotateCcw aria-hidden /> Try again
      </Button>
    </div>
  );
}
