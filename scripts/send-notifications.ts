// ---------------------------------------------------------------------------
// Templated client notifications — the BOT SENDER (auto-send + log).
//
//   npm run send:notifications                 # send TODAY's due notifications
//   npm run send:notifications -- --dry-run    # decide + print, send NOTHING
//   npm run send:notifications -- --date 2026-07-10
//
// Owner logic (kk 0036): the bot ALWAYS sends a due planned message at its
// scheduled time — it cannot be cancelled — and the accountant may edit the text
// until this runs; we send the LATEST text. Delivery is a SINGLE Telegram call
// (a document with the wording as caption, or one text message), so there is no
// partial state to duplicate.
//
// TEST-CHAT MODE (NOTIFICATIONS_TEST_CHAT_ID): while set, EVERY sendable
// notification is delivered to that ONE chat instead of the real client chats,
// bypassing the approved/attachment gates (no real client is contacted). This is
// the "send everything to the test chat until we allow real clients" mode. Unset
// it (and set the production gate) to deliver to real clients.
//
// PRODUCTION GATE (no test chat): a row is delivered only when its template is
// approved=true AND NOTIFICATIONS_SEND_ENABLED=1 (manual types also need a
// file/mark). Otherwise a safe dry-run.
//
// Reliability: a single-run LEASE LOCK (mqa_try_acquire_send_lock) prevents
// overlapping runs from both delivering. A successful delivery is recorded and
// the plan flipped to 'sent' ATOMICALLY (mqa_record_notification_sent) — never a
// send without a log, never 'sent' without a log. A prior success is detected
// and NOT re-sent. Failures are logged and retried next run.
//
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN,
//      NOTIFICATIONS_SEND_ENABLED, NOTIFICATIONS_TEST_CHAT_ID.
// ---------------------------------------------------------------------------
import { getServiceClient, isSupabaseConfigured } from "../src/lib/supabase/server";
import { postTelegramMessage, postTelegramDocumentByUrl } from "../src/lib/telegram-core";
import { telegramChatId } from "../src/lib/chat-list";
import { planDelivery, capCaption, type PlannedStatus } from "../src/lib/notifications";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function sendEnabled(): boolean {
  const v = (process.env.NOTIFICATIONS_SEND_ENABLED || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
const isHttpUrl = (s?: string | null) => !!s && /^https?:\/\//i.test(s);

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const refDate = arg("date") || new Date().toISOString().slice(0, 10);

  if (!isSupabaseConfigured()) {
    console.error("Supabase не настроен — рассылка уведомлений не запущена.");
    process.exit(1);
  }
  const db = getServiceClient()!;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const testChatId = (process.env.NOTIFICATIONS_TEST_CHAT_ID || "").trim() || null;
  const live = !dryRun && (testChatId ? true : sendEnabled());

  // Single-run lease: bail out if another run holds it (no concurrent delivery).
  const { data: gotLock, error: lockErr } = await db.rpc("mqa_try_acquire_send_lock", { p_ttl_seconds: 900 });
  if (lockErr) throw new Error(`lease: ${lockErr.message}`);
  if (!gotLock) {
    console.log("Другой запуск отправителя ещё выполняется — выходим.");
    return;
  }

  try {
    const { data: planned, error } = await db
      .from("mqa_planned_notifications")
      .select("*")
      .lte("scheduled_date", refDate)
      .in("status", ["planned", "edited"] satisfies PlannedStatus[]);
    if (error) throw new Error(`read planned: ${error.message}`);
    const rows = planned ?? [];
    if (rows.length === 0) {
      console.log(`Нет запланированных уведомлений на ${refDate}.`);
      return;
    }

    const agrNos = [...new Set(rows.map((r) => r.agr_no))];
    const tplIds = [...new Set(rows.map((r) => r.template_id).filter(Boolean))] as string[];
    const [{ data: chats }, { data: tpls }, { data: atts }] = await Promise.all([
      db.from("mqa_chats").select("agr_no, chat_link, status").in("agr_no", agrNos),
      tplIds.length
        ? db.from("mqa_notification_templates").select("id, approved").in("id", tplIds)
        : Promise.resolve({ data: [] as any[] }),
      db.from("mqa_notification_attachments").select("agr_no, period, category, file_url, file_name, marked_done").in("agr_no", agrNos),
    ]);
    const chatBy = new Map((chats ?? []).map((c) => [c.agr_no, c]));
    const tplApproved = new Map((tpls ?? []).map((t) => [t.id, !!t.approved]));
    const attBy = new Map((atts ?? []).map((a) => [`${a.agr_no}|${a.period}|${a.category}`, a]));

    let sent = 0, skipped = 0, dry = 0, failed = 0, dup = 0;

    for (const r of rows) {
      const tag = `${r.agr_no}/${r.category}/${r.subtype} (${r.mode})`;
      const chat = chatBy.get(r.agr_no);
      const clientChatId = telegramChatId(chat?.chat_link);
      const att = attBy.get(`${r.agr_no}|${r.period}|${r.category}`);

      // A prior run already delivered this row (success in the journal) but may
      // have died before flipping the status — reconcile, never re-send.
      const { data: prior, error: priorErr } = await db
        .from("mqa_sent_notifications").select("id").eq("planned_id", r.id).eq("telegram_ok", true).limit(1);
      if (priorErr) { console.log(`FAIL  ${tag}: журнал недоступен: ${priorErr.message}`); failed++; continue; }
      if (prior && prior.length > 0) {
        await db.from("mqa_planned_notifications").update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", r.id).in("status", ["planned", "edited"]);
        skipped++; console.log(`SKIP  ${tag}: уже доставлено ранее, статус синхронизирован`); continue;
      }

      const plan = planDelivery({
        status: r.status,
        mode: r.mode,
        requiresAttachment: r.requires_attachment,
        templateApproved: r.template_id ? tplApproved.get(r.template_id) ?? false : false,
        hasAttachmentOrDone: !!att && (!!att.file_url || att.marked_done === true),
        chatActive: (chat?.status ?? "Inactive") === "Active",
        chatId: clientChatId,
        sendEnabled: live,
        clientChatId,
        testChatId,
      });
      if (plan.action === "skip") { skipped++; console.log(`SKIP  ${tag}: ${plan.reason}`); continue; }

      const dest = plan.chatId!;
      const messageText = r.accompanying_text ? `${r.rendered_text}\n\n${r.accompanying_text}` : r.rendered_text;
      const fileForSend = isHttpUrl(att?.file_url) ? (att!.file_url as string) : null;
      const sentText = fileForSend ? capCaption(messageText) : messageText;
      const logText = fileForSend ? `${sentText}\n[вложение: ${att!.file_name || att!.file_url}]` : sentText;

      if (plan.action === "dry-run") {
        dry++; console.log(`DRY   ${tag} → chat ${dest}: ${plan.reason}\n      ${sentText}`); continue;
      }

      // Single delivery call — no partial state.
      const res = fileForSend
        ? await postTelegramDocumentByUrl(token!, dest, fileForSend, sentText)
        : await postTelegramMessage(token!, dest, sentText);

      // Atomic: journal + (on success) mark 'sent' in one transaction.
      const { data: outcome, error: recErr } = await db.rpc("mqa_record_notification_sent", {
        p_planned_id: r.id, p_agr_no: r.agr_no, p_chat_id: dest, p_category: r.category,
        p_subtype: r.subtype, p_language: r.language, p_full_text: logText,
        p_template_id: r.template_id, p_ok: res.ok, p_error: res.error ?? null,
      });
      if (recErr) {
        console.log(`WARN  ${tag} → chat ${dest}: доставка ${res.ok ? "ok" : "нет"}, журнал не записан: ${recErr.message}`);
        if (!res.ok) failed++;
        continue;
      }
      if (outcome === "recorded") { sent++; console.log(`SENT  ${tag} → chat ${dest}${fileForSend ? " (+документ)" : ""}${testChatId ? " [TEST]" : ""}`); }
      else if (outcome === "duplicate") { dup++; console.log(`DUP   ${tag} → chat ${dest}: успех уже записан ранее`); }
      else { failed++; console.log(`FAIL  ${tag} → chat ${dest}: ${res.error} (в журнале, будет повтор)`); }
    }

    console.log(
      `Готово (${refDate}): отправлено ${sent}, пропущено ${skipped}, ошибок ${failed}, дублей ${dup}, dry-run ${dry}` +
        (testChatId ? ` — ТЕСТ-режим: всё уходит в чат ${testChatId}` : live ? "" : " — живая отправка ВЫКЛючена")
    );
  } finally {
    await db.rpc("mqa_release_send_lock");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
