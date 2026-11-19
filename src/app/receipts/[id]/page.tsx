import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/validation/common";
import { requirePagePermission } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { getSale } from "@/server/services/sales";
import { getSettings } from "@/server/services/settings";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Receipt" };

/** 80 mm thermal-printer friendly receipt (also prints well on A4). */
export default async function ReceiptPage({ params, searchParams }: PageProps<"/receipts/[id]">) {
  await requirePagePermission("sales:view");
  const { id } = await params;
  const { print } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  const [sale, settings] = await Promise.all([getSale(db, id).catch(() => null), getSettings(db)]);
  if (!sale) notFound();
  const receipts = sale.payments.filter((p) => p.kind !== "REVERSAL" && !p.isReversed);

  return (
    <main className="min-h-svh bg-muted/40 py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[80mm] justify-between gap-2 px-2">
        <Button asChild variant="outline"><Link href={`/sales/${sale.id}`}>Back</Link></Button>
        <PrintButton autoPrint={print === "1"} />
      </div>
      <article className="mx-auto w-[80mm] max-w-full bg-white p-4 font-mono text-[11px] leading-snug text-black shadow print:shadow-none">
        <header className="text-center">
          <h1 className="font-sans text-sm font-bold tracking-wide">{settings.businessName}</h1>
          {settings.address && <p>{settings.address}</p>}
          {settings.phone && <p>Tel: {settings.phone}</p>}
          <p className="mt-2">{sale.status === "VOIDED" ? "*** VOIDED ***" : "SALES RECEIPT"}</p>
        </header>
        <div className="my-2 border-t border-dashed border-black" />
        <p>Receipt: {sale.saleNumber}</p>
        <p>Date: {formatDateTime(sale.createdAt)}</p>
        <p>Served by: {sale.cashierName}</p>
        {sale.customerName && <p>Customer: {sale.customerName}</p>}
        <div className="my-2 border-t border-dashed border-black" />
        <table className="w-full">
          <tbody>
            {sale.items.map((item) => (
              <tr key={item.id} className="align-top">
                <td className="pb-1">
                  {item.productName}
                  <br />
                  {item.quantity} x {formatMoney(item.unitPrice, { symbol: false })}
                  {item.discount > 0 && <> (−{formatMoney(item.discount, { symbol: false })})</>}
                </td>
                <td className="pb-1 text-right whitespace-nowrap">{formatMoney(item.lineTotal, { symbol: false })}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="my-2 border-t border-dashed border-black" />
        <dl className="space-y-0.5">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatMoney(sale.subtotal)}</dd></div>
          {sale.discountTotal > 0 && <div className="flex justify-between"><dt>Discount</dt><dd>−{formatMoney(sale.discountTotal)}</dd></div>}
          {sale.taxTotal > 0 && <div className="flex justify-between"><dt>{settings.taxLabel ?? "Tax"}</dt><dd>{formatMoney(sale.taxTotal)}</dd></div>}
          <div className="flex justify-between text-[13px] font-bold"><dt>TOTAL</dt><dd>{formatMoney(sale.total)}</dd></div>
          {receipts.map((p) => (
            <div key={p.id} className="flex justify-between"><dt>{PAYMENT_METHOD_LABELS[p.method as PaymentMethod]}</dt><dd>{formatMoney(p.amount)}</dd></div>
          ))}
          {sale.returned > 0 && <div className="flex justify-between"><dt>Returned</dt><dd>−{formatMoney(sale.returned)}</dd></div>}
          {sale.balance > 0 && <div className="flex justify-between font-bold"><dt>BALANCE DUE</dt><dd>{formatMoney(sale.balance)}</dd></div>}
        </dl>
        <div className="my-2 border-t border-dashed border-black" />
        <p className="text-center">{settings.receiptFooter}</p>
        <p className="mt-1 text-center">Prices in Ghana Cedis (GH₵)</p>
      </article>
    </main>
  );
}
