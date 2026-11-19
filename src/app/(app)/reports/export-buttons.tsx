"use client";

import { FileDown, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

interface ColumnMeta {
  key: string;
  label: string;
  type: "text" | "money" | "number" | "date" | "percent";
}

function cell(column: ColumnMeta, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (column.type === "money") return formatMoney(Number(value), { symbol: false });
  if (column.type === "date") return formatDate(String(value));
  if (column.type === "percent") return `${(Number(value) / 100).toFixed(1)}%`;
  return String(value);
}

export function ExportButtons({ query }: { query: string }) {
  const [isPending, start] = useTransition();

  function pdf() {
    start(async () => {
      try {
        const response = await fetch(`${query}&format=json`);
        if (!response.ok) throw new Error("Export failed");
        const { table, businessName } = (await response.json()) as {
          table: { title: string; subtitle: string; columns: ColumnMeta[]; rows: Record<string, unknown>[]; totals?: Record<string, unknown> };
          businessName: string;
        };
        const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
        const doc = new jsPDF({ orientation: table.columns.length > 5 ? "landscape" : "portrait" });
        doc.setFontSize(14);
        doc.text(businessName, 14, 16);
        doc.setFontSize(11);
        doc.text(`${table.title} — ${table.subtitle} (amounts in GHS)`, 14, 23);
        const rows = [...table.rows, ...(table.totals ? [table.totals] : [])];
        autoTable(doc, {
          startY: 28,
          head: [table.columns.map((c) => c.label)],
          body: rows.map((r) => table.columns.map((c) => cell(c, r[c.key]))),
          styles: { fontSize: 8 },
          headStyles: { fillColor: [31, 92, 72] },
          columnStyles: Object.fromEntries(table.columns.map((c, i) => [i, { halign: c.type === "text" || c.type === "date" ? "left" : "right" }])),
        });
        doc.save(`${table.title.toLowerCase().replace(/\s+/g, "-")}.pdf`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not create the PDF");
      }
    });
  }

  return (
    <div className="no-print flex flex-wrap gap-2">
      <Button asChild variant="outline" size="sm"><a href={`${query}&format=csv`}><FileText aria-hidden /> CSV</a></Button>
      <Button asChild variant="outline" size="sm"><a href={`${query}&format=xlsx`}><FileSpreadsheet aria-hidden /> Excel</a></Button>
      <Button variant="outline" size="sm" disabled={isPending} onClick={pdf}><FileDown aria-hidden /> {isPending ? "Preparing…" : "PDF"}</Button>
      <Button variant="outline" size="sm" onClick={() => window.print()}><Printer aria-hidden /> Print</Button>
    </div>
  );
}
