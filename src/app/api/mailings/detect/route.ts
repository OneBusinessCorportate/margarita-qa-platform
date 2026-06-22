import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { detectAllSignals, deriveStatus, type MailingSignal } from "@/lib/mailings-detect";
import { telegramChatId } from "@/lib/chat-list";
import { getAnthropic, CLAUDE_MODEL } from "@/lib/anthropic";

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

/** Armenia is UTC+4 (no DST). Subtracts 4 h so UTC midnight = Yerevan month start. */
function yerevanPeriodBounds(period: string): { start: string; end: string } {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(4, 6)); // 1-based
  const offsetMs = 4 * 60 * 60 * 1000; // UTC+4
  const start = new Date(Date.UTC(y, m - 1, 1) - offsetMs);
  const end = new Date(Date.UTC(y, m, 1) - offsetMs);
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * Ask Claude to classify a batch of messages that matched no keyword rules.
 * Returns signals (may be empty) for each message index.
 */
async function classifyWithAI(
  messages: { text: string }[]
): Promise<MailingSignal[][]> {
  const ai = getAnthropic();
  if (!ai || messages.length === 0) return messages.map(() => []);

  const BATCH = 30;
  const results: MailingSignal[][] = Array(messages.length).fill(null).map(() => []);

  for (let i = 0; i < messages.length; i += BATCH) {
    const batch = messages.slice(i, i + BATCH);
    const numbered = batch
      .map((m, idx) => `[${i + idx}] ${m.text.slice(0, 300)}`)
      .join("\n---\n");

    const prompt = `You are classifying accountant messages from an Armenian accounting firm's chat tool.
For each numbered message below, identify mailing signals (if any).

Signal categories and types:
- main_taxes/done: accountant sent/submitted tax returns or VAT
- salary/done: accountant received/provided salary docs/payroll
- salary/req: accountant requested salary docs from client
- primary_docs/done: accountant received/provided primary documents (acts, invoices)
- primary_docs/req: accountant requested primary docs from client
- debts/paid: client paid debt / debt is closed
- debts/call: accountant called client about debt
- debts/req: accountant wrote to client about debt

Messages may be in Russian, Armenian, or mixed. Reply ONLY with a JSON array, one entry per message:
[{"idx": 0, "signals": [{"category": "debts", "type": "req"}]}, ...]
Omit entries with no signals. If uncertain, omit. Do NOT include markdown.

Messages:
${numbered}`;

    try {
      const resp = await ai.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });
      const raw = resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "[]";
      const parsed = JSON.parse(raw) as { idx: number; signals: MailingSignal[] }[];
      for (const entry of parsed) {
        if (Array.isArray(entry.signals) && entry.idx >= i && entry.idx < i + batch.length) {
          results[entry.idx] = entry.signals.filter(
            (s) =>
              ["main_taxes", "salary", "primary_docs", "debts"].includes(s.category) &&
              ["done", "req", "call", "paid"].includes(s.type)
          );
        }
      }
    } catch {
      // AI unavailable or parse error — signals stay empty for this batch
    }
  }

  return results;
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

  const { start: periodStart, end: periodEnd } = yerevanPeriodBounds(period);

  // Load ALL chats (including inactive — a chat deactivated mid-month still had
  // accountant messages we need to count).
  const { data: chats, error: chatsErr } = await sb
    .from("mqa_chats")
    .select("agr_no, chat_link")
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

  // Fetch accountant messages in the period (Yerevan-timezone-bounded).
  const PAGE = 1000;
  const allMessages: { chat_id: string | number; text: string; created_at: string }[] = [];
  let pageError: string | null = null;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("messages")
      .select("chat_id, text, created_at")
      .eq("sender_role", "accountant")
      .gte("created_at", periodStart)
      .lt("created_at", periodEnd)
      .not("text", "is", null)
      .range(from, from + PAGE - 1);
    if (error) {
      pageError = error.message;
      break;
    }
    const batch = (data ?? []) as typeof allMessages;
    allMessages.push(...batch);
    if (batch.length < PAGE) break;
  }
  if (pageError) return NextResponse.json({ error: pageError }, { status: 502 });

  // Count keyword-based signals per (agr_no, category, type).
  type CountKey = string; // `${agr_no}|${category}`
  const counters = new Map<
    CountKey,
    { agr_no: string; category: string; done: number; req: number; call: number; paid: number; latestAt: string }
  >();

  // Track unmatched messages for AI fallback (only if Anthropic is configured).
  const aiCandidates: { chat_id: string; text: string; created_at: string }[] = [];

  for (const msg of allMessages) {
    const agr_no = chatIdToAgr.get(String(msg.chat_id));
    if (!agr_no) continue;

    const signals = detectAllSignals(msg.text);
    if (signals.length === 0 && msg.text.length >= 20) {
      // No keyword match — candidate for AI classification
      aiCandidates.push({ chat_id: String(msg.chat_id), text: msg.text, created_at: msg.created_at });
      continue;
    }

    for (const signal of signals) {
      const key: CountKey = `${agr_no}|${signal.category}`;
      if (!counters.has(key)) {
        counters.set(key, { agr_no, category: signal.category, done: 0, req: 0, call: 0, paid: 0, latestAt: msg.created_at });
      }
      const c = counters.get(key)!;
      c[signal.type]++;
      if (msg.created_at > c.latestAt) c.latestAt = msg.created_at;
    }
  }

  // AI fallback: classify unmatched messages in batches (cap at 200 to stay fast).
  let aiCount = 0;
  const aiCapped = aiCandidates.slice(0, 200);
  if (aiCapped.length > 0) {
    const aiSignalsList = await classifyWithAI(aiCapped.map((m) => ({ text: m.text })));
    for (let i = 0; i < aiCapped.length; i++) {
      const msg = aiCapped[i];
      const agr_no = chatIdToAgr.get(msg.chat_id);
      if (!agr_no) continue;
      const msgSignals = aiSignalsList[i] ?? [];
      if (msgSignals.length > 0) aiCount++;
      for (const signal of msgSignals) {
        const key: CountKey = `${agr_no}|${signal.category}`;
        if (!counters.has(key)) {
          counters.set(key, { agr_no, category: signal.category, done: 0, req: 0, call: 0, paid: 0, latestAt: msg.created_at });
        }
        const c = counters.get(key)!;
        c[signal.type]++;
        if (msg.created_at > c.latestAt) c.latestAt = msg.created_at;
      }
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
    return NextResponse.json({ period, messages_scanned: allMessages.length, upserted: 0, ai_classified: aiCount });
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
    unique_signals: counters.size,
    statuses_derived: derived.length,
    upserted: upsertRows.length,
    skipped_manual: manualSet.size,
    ai_classified: aiCount,
  });
}
