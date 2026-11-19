import { NextResponse, type NextRequest } from "next/server";
import { resolvePeriod, type PeriodKey } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { getCurrentSession } from "@/server/auth/current-user";
import { checkRateLimit } from "@/server/auth/rate-limit";
import { getDb } from "@/server/db/client";
import { recordAudit } from "@/server/services/audit";
import { toCsv, toXlsx } from "@/server/services/reports/export";
import { buildReportTable, REPORTS, type ReportKey } from "@/server/services/reports/tables";
import { getSettings } from "@/server/services/settings";

/** CSV / Excel / JSON (for client-side PDF) export of any report. Owner and manager only. */
export async function GET(request: NextRequest, { params }: RouteContext<"/api/exports/[report]">) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!can(session.user.role, "reports:view")) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  if (!checkRateLimit(`export:${session.user.id}`, 60, 10 * 60_000).allowed) return NextResponse.json({ error: "Too many exports" }, { status: 429 });

  const { report } = await params;
  if (!(report in REPORTS)) return NextResponse.json({ error: "Unknown report" }, { status: 404 });
  const search = request.nextUrl.searchParams;
  const period = (["today", "week", "month", "year", "custom"].find((p) => p === search.get("period")) ?? "month") as PeriodKey;
  const range = resolvePeriod(period, search.get("from") ?? undefined, search.get("to") ?? undefined);
  const bucket = (["day", "week", "month"].find((b) => b === search.get("bucket")) ?? "day") as "day" | "week" | "month";
  const format = search.get("format") ?? "csv";
  const db = getDb();
  const table = await buildReportTable(db, report as ReportKey, range, bucket);
  const filename = `${report}-${range.from}-to-${range.to}`;

  await recordAudit(db, { userId: session.user.id, action: "report.exported", entityType: "report", entityId: report, after: { format, from: range.from, to: range.to } });

  if (format === "json") return NextResponse.json({ table, businessName: (await getSettings(db)).businessName });
  if (format === "xlsx") {
    const buffer = await toXlsx(table, (await getSettings(db)).businessName);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  }
  return new NextResponse(toCsv(table), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}.csv"`, "Cache-Control": "no-store" },
  });
}
