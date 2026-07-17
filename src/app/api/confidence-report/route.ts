import { NextResponse } from "next/server";
import { listEvaluations } from "@/lib/repo";
import { buildConfidenceReport } from "@/lib/confidence-report";
import type { ConfidenceReportFilters } from "@/lib/confidence-report";
import type { ReviewStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const REVIEW_STATUSES: ReviewStatus[] = ["not_reviewed", "accepted", "corrected"];
const MATCH_STATUSES = ["exact", "partial", "mismatch"] as const;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status");
  const matchParam = searchParams.get("matchStatus");
  const filters: ConfidenceReportFilters = {
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    accountant: searchParams.get("accountant") ?? undefined,
    chat: searchParams.get("chat") ?? undefined,
    category: searchParams.get("category") ?? undefined,
    confidenceRange: searchParams.get("confidenceRange") ?? undefined,
    status: REVIEW_STATUSES.includes(statusParam as ReviewStatus)
      ? (statusParam as ReviewStatus)
      : undefined,
    matchStatus: (MATCH_STATUSES as readonly string[]).includes(matchParam ?? "")
      ? (matchParam as ConfidenceReportFilters["matchStatus"])
      : undefined,
  };
  try {
    // Fetch by the query-pushable filters (date/accountant); the rest are applied
    // in-memory by buildConfidenceReport so every metric respects them.
    const evaluations = await listEvaluations({
      from: filters.from,
      to: filters.to,
      accountant: filters.accountant,
    });
    const report = buildConfidenceReport(evaluations, filters);
    return NextResponse.json(report);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ошибка построения отчёта";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
