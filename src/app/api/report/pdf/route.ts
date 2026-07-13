import { assemblePdfReport } from "@/lib/report-data";
import { buildReportPdf } from "@/lib/report-pdf";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/report/pdf?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * The monitoring grid as a downloadable PDF (day columns × accountant rows,
 * colour-coded like the spreadsheet) — the same document the Telegram send
 * attaches to the daily report message. A single-day request renders the
 * week-so-far grid (Monday → that day).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const { report, resolved, roster, violations } = await assemblePdfReport(
    searchParams.get("from") ?? undefined,
    searchParams.get("to") ?? undefined
  );
  const pdf = await buildReportPdf(report, { roster, violations });
  const filename = `report-${resolved.from}_${resolved.to}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
