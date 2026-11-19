"use client";

import { UserPlus, UserRound, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createCustomerAction, searchCustomersAction } from "@/server/actions/sales";

export interface PickedCustomer {
  id: string;
  fullName: string;
  phone: string | null;
}

export function CustomerPicker({ value, onChange, canCreate }: { value: PickedCustomer | null; onChange: (c: PickedCustomer | null) => void; canCreate: boolean }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<PickedCustomer[]>([]);
  const [isSearching, startSearch] = useTransition();
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => {
      startSearch(async () => {
        const result = await searchCustomersAction(term);
        if (result.ok) setResults(result.data);
      });
    }, 250);
    return () => clearTimeout(handle);
  }, [term, open]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border bg-accent/40 px-3 py-2 text-sm">
        <span className="flex min-w-0 items-center gap-2">
          <UserRound className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="truncate font-medium">{value.fullName}</span>
          {value.phone && <span className="text-xs text-muted-foreground">{value.phone}</span>}
        </span>
        <Button variant="ghost" size="icon-sm" aria-label="Remove customer" onClick={() => onChange(null)}><X aria-hidden /></Button>
      </div>
    );
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-start font-normal text-muted-foreground">
            <UserRound aria-hidden /> Walk-in customer · add name
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Name or phone…" value={term} onValueChange={setTerm} />
            <CommandList>
              <CommandEmpty>{isSearching ? "Searching…" : "No customer found."}</CommandEmpty>
              <CommandGroup>
                {results.map((c) => (
                  <CommandItem key={c.id} value={c.id} onSelect={() => { onChange(c); setOpen(false); }}>
                    <span className="truncate">{c.fullName}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{c.phone}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
            {canCreate && (
              <div className="border-t p-1.5">
                <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => { setOpen(false); setAdding(true); }}>
                  <UserPlus aria-hidden /> New customer{term ? ` “${term}”` : ""}
                </Button>
              </div>
            )}
          </Command>
        </PopoverContent>
      </Popover>
      {adding && <QuickAddCustomer initialName={term} onClose={() => setAdding(false)} onCreated={(c) => { onChange(c); setAdding(false); }} />}
    </>
  );
}

function QuickAddCustomer({ initialName, onClose, onCreated }: { initialName: string; onClose: () => void; onCreated: (c: PickedCustomer) => void }) {
  const [name, setName] = useState(/^\+?\d[\d\s]+$/.test(initialName) ? "" : initialName);
  const [phone, setPhone] = useState(/^\+?\d[\d\s]+$/.test(initialName) ? initialName : "");
  const [isPending, start] = useTransition();
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>New customer</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label htmlFor="qc-name">Full name</Label><Input id="qc-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
          <div className="grid gap-1.5"><Label htmlFor="qc-phone">Phone</Label><Input id="qc-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={isPending || name.trim().length === 0}
            onClick={() =>
              start(async () => {
                const result = await createCustomerAction({ fullName: name, phone, email: "", address: "", notes: "" });
                if (result.ok) onCreated(result.data);
                else toast.error(result.error);
              })
            }
          >
            Save customer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
