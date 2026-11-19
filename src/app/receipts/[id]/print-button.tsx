"use client";

import { Printer } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export function PrintButton({ autoPrint }: { autoPrint: boolean }) {
  useEffect(() => {
    if (autoPrint) window.print();
  }, [autoPrint]);
  return (
    <Button onClick={() => window.print()} className="no-print">
      <Printer aria-hidden /> Print receipt
    </Button>
  );
}
