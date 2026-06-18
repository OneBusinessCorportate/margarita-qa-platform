import { NextResponse } from "next/server";
import { getOneBusinessClient } from "@/lib/supabase/onebusiness";
import { aggregateDebts, normalizeAgrNo, type DebtRow } from "@/lib/debts";
import { syncDebts } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Pull active debts from the OneBusiness debts system (ob_app.debts_current),
 * aggregate per agreement into overdue/upcoming, and mirror into mqa_debts +
 * mqa_chats.debts. Intended to run on a schedule (host cron hitting this route)
 * so debts become automatic instead of a manual XLSX import.
 */
export async function POST() {
  const ob = getOneBusinessClient();
  if (!ob) {
    return NextResponse.json(
      {
        error:
          "OneBusiness debts source not configured (ONEBUSINESS_SUPABASE_URL / _SERVICE_ROLE_KEY).",
      },
      { status: 503 }
    );
  }

  // Pull active debt rows, paging to clear PostgREST's default row cap.
  const rows: DebtRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await ob
      .from("debts_current")
      .select("agr_id, due_dt, debt, status")
      .eq("status", "active")
      .range(from, from + PAGE - 1);
    if (error)
      return NextResponse.json(
        { error: `OneBusiness read failed: ${error.message}` },
        { status: 502 }
      );
    const batch = (data ?? []) as DebtRow[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }

  const asOf = new Date().toISOString().slice(0, 10);
  const byNorm = aggregateDebts(rows, asOf);
  const { updated, withDebt } = await syncDebts(byNorm, normalizeAgrNo);

  return NextResponse.json({
    source_rows: rows.length,
    agreements_with_debt: byNorm.size,
    chats_updated: updated,
    chats_with_overdue: withDebt,
    as_of: asOf,
  });
}
