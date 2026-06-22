import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { detectMailings } from "@/lib/mailings-detect";
import { telegramChatId } from "@/lib/chat-list";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/mailings/detect
 * Body (optional): { period?: "YYYYMM" }   defaults to current Yerevan month
 *
 * Scans accountant messages in public.messages for the given period,
 * classifies them by mailing category (taxes / salary / docs / debts), and
 * upserts the best-detected status per (chat, category) into mqa_chat_mailings.
 * Manual-confirmed rows (source = 'manual') are never overwritten.
 *
 * Also callable as GET for a quick health / trigger (body is ignored).
 */
export async function POST(req: Request) {
  return run(req);
}
export async function GET() {
  return run();
}

async function run(req?: Request) {
  const sb = getServiceClient();
  if (!sb) {
    return NextResponse.json({ error: "Supabase not configured." }, { status: 503 });
  }

  // Parse optional period from body; default to current Yerevan month.
  let period = "";
  if (req) {
    try {
      const body = await req.json().catch(() => ({}));
      if (typeof body?.period === "string" && /^\d{6}$/.test(body.period)) {
        period = body.period;
      }
    } catch {
      // ignore
    }
  }
  if (!period) {
    const now = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Asia/Yerevan" })
    );
    period = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  const periodStart = `${period.slice(0, 4)}-${period.slice(4, 6)}-01`;
  const nextMonth = new Date(
    Date.UTC(Number(period.slice(0, 4)), Number(period.slice(4, 6)), 1)
  );
  const periodEnd = nextMonth.toISOString().slice(0, 10);

  // Load all active chats + their Telegram chat ids.
  const { data: chats, error: chatsErr } = await sb
    .from("mqa_chats")
    .select("agr_no, chat_link")
    .eq("status", "Active")
    .not("chat_link", "is", null);
  if (chatsErr) {
    return NextResponse.json({ error: chatsErr.message }, { status: 502 });
  }

  // Build a map: Telegram chat_id (string) → agr_no
  const chatIdToAgr = new Map<string, string>();
  for (const c of chats ?? []) {
    const cid = telegramChatId(c.chat_link as string | null);
    if (cid) chatIdToAgr.set(cid, c.agr_no as string);
  }

  if (chatIdToAgr.size === 0) {
    return NextResponse.json({ period, messages_scanned: 0, upserted: 0 });
  }

  // Fetch accountant messages in the period (page through PostgREST limit).
  const PAGE = 1000;
  const allMessages: { chat_id: string; text: string; created_at: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("messages")
      .select("chat_id, text, created_at")
      .eq("sender_role", "accountant")
      .gte("created_at", periodStart)
      .lt("created_at", periodEnd)
      .not("text", "is", null)
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });
    const batch = (data ?? []) as typeof allMessages;
    allMessages.push(...batch);
    if (batch.length < PAGE) break;
  }

  // Classify messages and accumulate best signal per (agr_no, category).
  type BestKey = string; // `${agr_no}|${category}`
  const best = new Map<
    BestKey,
    { agr_no: string; category: string; status: string; priority: number; detected_at: string }
  >();

  for (const msg of allMessages) {
    const agr_no = chatIdToAgr.get(String(msg.chat_id));
    if (!agr_no) continue;

    for (const signal of detectMailings(msg.text)) {
      const key: BestKey = `${agr_no}|${signal.category}`;
      const prev = best.get(key);
      if (!prev || signal.priority > prev.priority) {
        best.set(key, {
          agr_no,
          category: signal.category,
          status: signal.status,
          priority: signal.priority,
          detected_at: msg.created_at,
        });
      }
    }
  }

  if (best.size === 0) {
    return NextResponse.json({ period, messages_scanned: allMessages.length, upserted: 0 });
  }

  // Upsert detected rows into mqa_chat_mailings.
  // Manual-confirmed rows are excluded via the SQL WHERE clause.
  const rows = [...best.values()].map(({ agr_no, category, status, detected_at }) => ({
    agr_no,
    period,
    category,
    status,
    source: "telegram",
    detected_at,
    updated_at: new Date().toISOString(),
  }));

  // We can't express "only update if source != 'manual'" in a single PostgREST
  // upsert, so we use a raw SQL call via rpc, falling back to a manual filter loop.
  // Strategy: first load existing manual rows, then skip those in the upsert.
  const { data: manualRows } = await sb
    .from("mqa_chat_mailings")
    .select("agr_no, category")
    .eq("period", period)
    .eq("source", "manual");

  const manualSet = new Set(
    (manualRows ?? []).map((r: { agr_no: string; category: string }) => `${r.agr_no}|${r.category}`)
  );

  const upsertRows = rows.filter(
    (r) => !manualSet.has(`${r.agr_no}|${r.category}`)
  );

  if (upsertRows.length > 0) {
    const { error: upsertErr } = await sb
      .from("mqa_chat_mailings")
      .upsert(upsertRows, { onConflict: "agr_no,period,category" });
    if (upsertErr) {
      return NextResponse.json({ error: upsertErr.message }, { status: 502 });
    }
  }

  return NextResponse.json({
    period,
    messages_scanned: allMessages.length,
    signals_detected: best.size,
    upserted: upsertRows.length,
    skipped_manual: manualSet.size,
  });
}
