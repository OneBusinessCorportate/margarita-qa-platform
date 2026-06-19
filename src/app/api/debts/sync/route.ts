import { NextResponse } from "next/server";
import { getOneBusinessClient } from "@/lib/supabase/onebusiness";
import {
  aggregateDebts,
  debtFollowupStatus,
  normalizeAgrNo,
  type DebtRow,
} from "@/lib/debts";
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

  // Contact log for the current month → per-agreement message/call counts, so we
  // can derive the «Долги» follow-up status (1-й написал / позвонил / Не написал).
  const monthStart = asOf.slice(0, 8) + "01";
  const contacts = new Map<string, { messages: number; calls: number }>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await ob
      .from("communications")
      .select("agr_id, contact_type, event_date, created_at")
      .gte("event_date", monthStart)
      .range(from, from + PAGE - 1);
    if (error) break; // contact log is best-effort; debts still sync without it
    const batch = (data ?? []) as any[];
    for (const r of batch) {
      const key = normalizeAgrNo(r.agr_id);
      if (!key) continue;
      const cur = contacts.get(key) ?? { messages: 0, calls: 0 };
      if (r.contact_type === "call") cur.calls++;
      else if (r.contact_type === "message") cur.messages++;
      contacts.set(key, cur);
    }
    if (batch.length < PAGE) break;
  }

  const statusByNorm = new Map<string, string>();
  for (const [norm, totals] of byNorm) {
    const c = contacts.get(norm) ?? { messages: 0, calls: 0 };
    statusByNorm.set(norm, debtFollowupStatus(totals.overdue, c.messages, c.calls));
  }

  const { updated, withDebt } = await syncDebts(byNorm, normalizeAgrNo, statusByNorm);

  return NextResponse.json({
    source_rows: rows.length,
    agreements_with_debt: byNorm.size,
    chats_updated: updated,
    chats_with_overdue: withDebt,
    as_of: asOf,
  });
}
