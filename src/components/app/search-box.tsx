"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";

/** URL-driven search: submits on Enter and keeps other filters, resetting pagination. */
export function SearchBox({ placeholder = "Search…", param = "q" }: { placeholder?: string; param?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get(param) ?? "");
  const [isPending, startTransition] = useTransition();

  function apply(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.trim()) params.set(param, next.trim());
    else params.delete(param);
    params.delete("page");
    params.delete("before");
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  return (
    <form
      role="search"
      className="relative w-full sm:max-w-xs"
      onSubmit={(event) => {
        event.preventDefault();
        apply(value);
      }}
    >
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pr-8 pl-8"
        aria-busy={isPending}
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            setValue("");
            apply("");
          }}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Clear search"
        >
          <X className="size-3.5" />
        </button>
      )}
    </form>
  );
}
