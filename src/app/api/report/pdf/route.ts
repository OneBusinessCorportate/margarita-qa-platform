import { assembleReport } from "@/lib/report-data";
import { buildReportPdf } from "@/lib/report-pdf";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/report/pdf?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * The analytics report as a downloadable PDF (metrics, analysis, tables) —
 * the same document the Telegram send attaches to the report message.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const { report, previous, resolved, violations, roster, requests, requestDays } =
    await assembleReport(
      searchParams.get("from") ?? undefined,
      searchParams.get("to") ?? undefined
    );
  const pdf = await buildReportPdf(report, {
    previous,
    violations,
    roster,
    requests,
    requestDays,
  });
  const filename = `report-${resolved.from}_${resolved.to}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
