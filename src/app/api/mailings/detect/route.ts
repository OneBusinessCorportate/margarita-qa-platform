import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { detectAllSignals, deriveStatus } from "@/lib/mailings-detect";
import { telegramChatId } from "@/lib/chat-list";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/mailings/detect
 * Body (optional): { period?: "YYYYMM" }   defaults to current Yerevan month
 *
 * Scans accountant messages in public.messages for the given period,
 * counts signal types per (chat, category), derives the graduated mailing
 * status (e.g. "Запросил 2" after two requests), and upserts into
 * mqa_chat_mailings. Manual-confirmed rows (source='manual') are protected.
 *
 * Also callable as GET for a quick health-check or scheduled trigger.
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

  // Load active chats and build chat_id → agr_no map.
  const { data: chats, error: chatsErr } = await sb
    .from("mqa_chats")
    .select("agr_no, chat_link")
    .eq("status", "Active")
    .not("chat_link", "is", null);
  if (chatsErr) return NextResponse.json({ error: chatsErr.message }, { status: 502 });

  const chatIdToAgr = new Map<string, string>();
  for (const c of chats ?? []) {
    const cid = telegramChatId(c.chat_link as string | null);
    if (cid) chatIdToAgr.set(cid, c.agr_no as string);
  }
  if (chatIdToAgr.size === 0) {
    return NextResponse.json({ period, messages_scanned: 0, upserted: 0 });
  }

  // Fetch accountant messages in the period.
  const PAGE = 1000;
  const allMessages: { chat_id: string | number; text: string; created_at: string }[] = [];
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

  // Count signals per (agr_no, category, type).
  type CountKey = string; // `${agr_no}|${category}`
  const counters = new Map<
    CountKey,
    { agr_no: string; category: string; done: number; req: number; call: number; paid: number; latestAt: string }
  >();

  for (const msg of allMessages) {
    const agr_no = chatIdToAgr.get(String(msg.chat_id));
    if (!agr_no) continue;

    for (const signal of detectAllSignals(msg.text)) {
      const key: CountKey = `${agr_no}|${signal.category}`;
      if (!counters.has(key)) {
        counters.set(key, { agr_no, category: signal.category, done: 0, req: 0, call: 0, paid: 0, latestAt: msg.created_at });
      }
      const c = counters.get(key)!;
      c[signal.type]++;
      if (msg.created_at > c.latestAt) c.latestAt = msg.created_at;
    }
  }

  // Derive graduated status from counts.
  type Derived = { agr_no: string; category: string; status: string; detected_at: string };
  const derived: Derived[] = [];
  for (const [, c] of counters) {
    const status = deriveStatus(c.category, c);
    if (status) derived.push({ agr_no: c.agr_no, category: c.category, status, detected_at: c.latestAt });
  }

  if (derived.length === 0) {
    return NextResponse.json({ period, messages_scanned: allMessages.length, upserted: 0 });
  }

  // Load manual rows so we never overwrite them.
  const { data: manualRows } = await sb
    .from("mqa_chat_mailings")
    .select("agr_no, category")
    .eq("period", period)
    .eq("source", "manual");

  const manualSet = new Set(
    (manualRows ?? []).map((r: { agr_no: string; category: string }) => `${r.agr_no}|${r.category}`)
  );

  const upsertRows = derived
    .filter((r) => !manualSet.has(`${r.agr_no}|${r.category}`))
    .map((r) => ({
      agr_no: r.agr_no,
      period,
      category: r.category,
      status: r.status,
      source: "telegram",
      detected_at: r.detected_at,
      updated_at: new Date().toISOString(),
    }));

  if (upsertRows.length > 0) {
    const { error: upsertErr } = await sb
      .from("mqa_chat_mailings")
      .upsert(upsertRows, { onConflict: "agr_no,period,category" });
    if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 502 });
  }

  return NextResponse.json({
    period,
    messages_scanned: allMessages.length,
    signals_counted: counters.size,
    statuses_derived: derived.length,
    upserted: upsertRows.length,
    skipped_manual: manualSet.size,
  });
}
