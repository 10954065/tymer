import ExcelJS from "exceljs";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { ReportColumn, ReportRow, ReportTable } from "./tables";

/** Human-readable cell text (DD/MM/YYYY dates, cedi amounts, percentages from basis points). */
export function formatCell(column: ReportColumn, value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  switch (column.type) {
    case "money":
      return formatMoney(Number(value), { symbol: false });
    case "date":
      return formatDate(String(value));
    case "percent":
      return `${(Number(value) / 100).toFixed(1)}%`;
    case "number":
      return String(value);
    default:
      return String(value);
  }
}

function csvEscape(value: string): string {
  // Prevent spreadsheet formula injection and quote every field.
  const safe = /^[=+\-@\t\r]/.test(value) && !/^-?\d/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function toCsv(table: ReportTable): string {
  const lines = [table.columns.map((c) => csvEscape(c.label)).join(",")];
  const all: ReportRow[] = table.totals ? [...table.rows, table.totals] : table.rows;
  for (const row of all) lines.push(table.columns.map((c) => csvEscape(formatCell(c, row[c.key]))).join(","));
  return `﻿${table.title} (${table.subtitle})\r\n${lines.join("\r\n")}\r\n`;
}

export async function toXlsx(table: ReportTable, businessName: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = businessName;
  const sheet = workbook.addWorksheet(table.title.slice(0, 31));
  sheet.addRow([businessName]).font = { bold: true, size: 13 };
  sheet.addRow([`${table.title} — ${table.subtitle}`]).font = { italic: true };
  sheet.addRow([]);
  const header = sheet.addRow(table.columns.map((c) => c.label));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7EFEA" } };
  });
  const all: ReportRow[] = table.totals ? [...table.rows, table.totals] : table.rows;
  all.forEach((row, index) => {
    const excelRow = sheet.addRow(
      table.columns.map((c) => {
        const v = row[c.key];
        if (v === null || v === undefined) return null;
        if (c.type === "money") return Number(v) / 100;
        if (c.type === "percent") return Number(v) / 10000;
        if (c.type === "number") return Number(v);
        if (c.type === "date") return formatDate(String(v));
        return String(v);
      }),
    );
    if (table.totals && index === all.length - 1) excelRow.font = { bold: true };
  });
  table.columns.forEach((c, i) => {
    const column = sheet.getColumn(i + 1);
    column.width = c.type === "text" ? 32 : 16;
    if (c.type === "money") column.numFmt = '#,##0.00;[Red]-#,##0.00';
    if (c.type === "percent") column.numFmt = "0.0%";
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
