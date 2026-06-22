import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/mailings/confirm
 * Body: { agr_no, period, category, status }
 *
 * Upserts a mailing row with source='manual' + confirmed=true, locking it
 * against future auto-detection overwrites. If status is empty/null, the
 * row is deleted (un-confirm).
 */
export async function POST(req: Request) {
  const sb = getServiceClient();
  if (!sb) {
    return NextResponse.json({ error: "Supabase not configured." }, { status: 503 });
  }

  const session = await getSession();
  const by = session?.email ?? "unknown";

  const body = await req.json().catch(() => null);
  const { agr_no, period, category, status } = body ?? {};

  if (!agr_no || !period || !category) {
    return NextResponse.json({ error: "agr_no, period, category required." }, { status: 400 });
  }

  // Empty status = un-confirm (delete the manual row so auto-detect takes over).
  if (!status) {
    const { error } = await sb
      .from("mqa_chat_mailings")
      .delete()
      .eq("agr_no", agr_no)
      .eq("period", period)
      .eq("category", category)
      .eq("source", "manual");
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });
    return NextResponse.json({ deleted: true });
  }

  const { error } = await sb.from("mqa_chat_mailings").upsert(
    {
      agr_no,
      period,
      category,
      status,
      source: "manual",
      confirmed: true,
      confirmed_by: by,
      confirmed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "agr_no,period,category" }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 502 });
  return NextResponse.json({ ok: true, agr_no, period, category, status });
}
