import { assemblePdfReport, type ReportPeriod } from "@/lib/report-data";
import { buildReportPdf } from "@/lib/report-pdf";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/report/pdf?from=YYYY-MM-DD&to=YYYY-MM-DD&period=daily|weekly
 *
 * Two shapes, matching the two Telegram messages:
 *   • period=daily (default) — the single-day report (service %, «Звезда дня»,
 *     «Кол-во запросов за день» with нарушения). Identical to the daily message.
 *   • period=weekly — the day-by-day monitoring grid (Monday → the reported day).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const period: ReportPeriod = searchParams.get("period") === "weekly" ? "weekly" : "daily";
  const { report, resolved, roster, violations, requests, mode } = await assemblePdfReport(
    searchParams.get("from") ?? undefined,
    searchParams.get("to") ?? undefined,
    period
  );
  const pdf = await buildReportPdf(report, { roster, violations, requests, mode });
  const filename = `report-${mode}-${resolved.from}_${resolved.to}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
