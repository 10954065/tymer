"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { CloudOff, CloudUpload, RefreshCw, TriangleAlert, Wifi } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatMoney } from "@/lib/money";
import { posDb } from "@/lib/offline/db";
import { flushOutbox } from "@/lib/offline/outbox";
import { cn } from "@/lib/utils";

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

/**
 * Header indicator: connection state, sales waiting to sync and conflicts. Sync runs on load, when the connection
 * returns, on Background Sync messages, and retries with backoff only while sales are waiting (no idle polling).
 */
export function SyncStatus() {
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoff = useRef(15_000);
  const outbox = useLiveQuery(() => posDb().outbox.toArray(), [], []);
  const pending = outbox.filter((s) => s.status !== "synced" && s.status !== "conflict");
  const conflicts = outbox.filter((s) => s.status === "conflict");

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    async function sync(manual = false) {
      if (!navigator.onLine) return;
      setBusy(true);
      try {
        const result = await flushOutbox();
        if (result.synced > 0) toast.success(`${result.synced} offline sale(s) synced`);
        if (result.conflicts > 0) toast.warning(`${result.conflicts} offline sale(s) need owner review`);
        if (manual && result.synced === 0 && result.remaining === 0 && result.conflicts === 0) toast.info("Everything is up to date");
        if (retryTimer.current) clearTimeout(retryTimer.current);
        if (result.remaining > 0) {
          retryTimer.current = setTimeout(() => void sync(), backoff.current);
          backoff.current = Math.min(backoff.current * 2, 5 * 60_000);
        } else {
          backoff.current = 15_000;
        }
      } finally {
        setBusy(false);
      }
    }
    const onMessage = (event: MessageEvent) => event.data?.type === "slb-flush-outbox" && void sync();
    const onOnline = () => void sync();
    const onManual = () => void sync(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("slb-sync-now", onManual);
    navigator.serviceWorker?.addEventListener("message", onMessage);
    void sync();
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("slb-sync-now", onManual);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, []);

  const Icon = !online ? CloudOff : conflicts.length ? TriangleAlert : pending.length ? CloudUpload : Wifi;
  const label = !online ? "Offline" : pending.length ? `${pending.length} to sync` : conflicts.length ? `${conflicts.length} conflict(s)` : "Online";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`Sync status: ${label}`}
          className={cn("gap-1.5", !online && "text-warning-foreground dark:text-warning", conflicts.length > 0 && "text-destructive")}>
          <Icon className={cn("size-4", busy && "animate-pulse")} aria-hidden />
          <span className="hidden text-xs sm:inline">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <p className="text-sm font-medium">{online ? "Connected" : "Working offline"}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {online ? "Sales are recorded directly on the server." : "Sales are saved on this device and will sync automatically when the connection returns."}
        </p>
        {pending.length > 0 && (
          <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-xs">
            {pending.map((s) => (
              <li key={s.idempotencyKey} className="flex justify-between gap-2">
                <span>{new Date(s.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · {s.status}{s.lastError ? ` (${s.lastError})` : ""}</span>
                <span className="tabular-nums">{formatMoney(s.total)}</span>
              </li>
            ))}
          </ul>
        )}
        {conflicts.length > 0 && <p className="mt-3 text-xs text-destructive">{conflicts.length} sale(s) could not be recorded automatically and are waiting for owner review.</p>}
        <Button size="sm" variant="outline" className="mt-3 w-full" disabled={!online || busy} onClick={() => window.dispatchEvent(new Event("slb-sync-now"))}>
          <RefreshCw className={cn(busy && "animate-spin")} aria-hidden /> Sync now
        </Button>
      </PopoverContent>
    </Popover>
  );
}
