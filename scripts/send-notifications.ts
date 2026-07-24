// ---------------------------------------------------------------------------
// Templated client notifications — the BOT SENDER (auto-send + log).
//
//   npm run send:notifications                 # send TODAY's due notifications
//   npm run send:notifications -- --dry-run    # decide + print, send NOTHING
//   npm run send:notifications -- --date 2026-07-10
//
// Owner logic (kk 0036): the bot ALWAYS sends a due planned message at its
// scheduled time — it cannot be cancelled — and the accountant may edit the
// text up until this runs; we send the LATEST text. Delivery is a SINGLE
// Telegram call (a document with the wording as caption, or one text message),
// so there is no partial state to duplicate on retry. Idempotency: a successful
// send is recorded once in mqa_sent_notifications (partial-unique on planned_id
// where telegram_ok), and a due row that already has a success record is NOT
// re-sent — it is only reconciled to 'sent'. A failed attempt is logged and the
// row is left for the next run (at-least-once; a duplicate is only possible if
// the process dies in the gap between Telegram accepting and the log commit —
// rare, and logged). The cron runs as a single Render instance (not parallel).
//
// GATED OFF BY DEFAULT: a row is delivered only when its template is
// approved=true AND NOTIFICATIONS_SEND_ENABLED=1 (and, for manual types, a file
// / mark-done exists). Otherwise it is a safe dry-run.
//
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN,
//      NOTIFICATIONS_SEND_ENABLED.
// ---------------------------------------------------------------------------
import { getServiceClient, isSupabaseConfigured } from "../src/lib/supabase/server";
import { postTelegramMessage, postTelegramDocumentByUrl } from "../src/lib/telegram-core";
import { telegramChatId } from "../src/lib/chat-list";
import { sendDecision, capCaption, type PlannedStatus } from "../src/lib/notifications";

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
  const live = sendEnabled() && !dryRun;

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

  let sent = 0, skipped = 0, dry = 0, failed = 0;

  for (const r of rows) {
    const tag = `${r.agr_no}/${r.category}/${r.subtype} (${r.mode})`;
    const chat = chatBy.get(r.agr_no);
    const chatId = telegramChatId(chat?.chat_link);
    const att = attBy.get(`${r.agr_no}|${r.period}|${r.category}`);

    // Dedup: a prior run already delivered this row (success in the log) but may
    // have died before flipping the status — reconcile, never re-send.
    const { data: prior, error: priorErr } = await db
      .from("mqa_sent_notifications").select("id").eq("planned_id", r.id).eq("telegram_ok", true).limit(1);
    if (priorErr) { console.log(`FAIL  ${tag}: журнал недоступен: ${priorErr.message}`); failed++; continue; }
    if (prior && prior.length > 0) {
      await db.from("mqa_planned_notifications").update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", r.id).in("status", ["planned", "edited"]);
      skipped++; console.log(`SKIP  ${tag}: уже доставлено ранее, статус синхронизирован`); continue;
    }

    const decision = sendDecision({
      status: r.status,
      mode: r.mode,
      requiresAttachment: r.requires_attachment,
      templateApproved: r.template_id ? tplApproved.get(r.template_id) ?? false : false,
      hasAttachmentOrDone: !!att && (!!att.file_url || att.marked_done === true),
      chatActive: (chat?.status ?? "Inactive") === "Active",
      chatId,
      sendEnabled: live,
    });
    if (decision.action === "skip") { skipped++; console.log(`SKIP  ${tag}: ${decision.reason}`); continue; }

    // The exact text = template + optional accompanying text. Whatever we send
    // is exactly what we log.
    const messageText = r.accompanying_text ? `${r.rendered_text}\n\n${r.accompanying_text}` : r.rendered_text;
    const fileForSend = isHttpUrl(att?.file_url) ? (att!.file_url as string) : null;
    const sentText = fileForSend ? capCaption(messageText) : messageText;
    const logText = fileForSend ? `${sentText}\n[вложение: ${att!.file_name || att!.file_url}]` : sentText;

    if (decision.action === "dry-run") {
      dry++; console.log(`DRY   ${tag} → chat ${chatId}: ${decision.reason}\n      ${sentText}`); continue;
    }

    // Single delivery call — no partial state.
    const res = fileForSend
      ? await postTelegramDocumentByUrl(token!, chatId!, fileForSend, sentText)
      : await postTelegramMessage(token!, chatId!, sentText);

    const { error: logErr } = await db.from("mqa_sent_notifications").insert({
      agr_no: r.agr_no, chat_id: chatId, category: r.category, subtype: r.subtype,
      language: r.language, full_text: logText, template_id: r.template_id, planned_id: r.id,
      telegram_ok: res.ok, telegram_error: res.error ?? null,
    });
    if (logErr) {
      // 23505 = a concurrent run already recorded a success for this planned_id;
      // do not re-mark, the other run owns it.
      if ((logErr as any).code === "23505") { skipped++; console.log(`SKIP  ${tag}: уже записано другим запуском`); continue; }
      console.log(`WARN  ${tag} → chat ${chatId}: доставка ${res.ok ? "ok" : "нет"}, журнал не записан: ${logErr.message}`);
    }

    if (res.ok) {
      await db.from("mqa_planned_notifications").update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", r.id).in("status", ["planned", "edited"]);
      sent++; console.log(`SENT  ${tag} → chat ${chatId}${fileForSend ? " (+документ)" : ""}`);
    } else {
      // Logged as failed; row stays sendable for the next run.
      failed++; console.log(`FAIL  ${tag} → chat ${chatId}: ${res.error} (в журнале, будет повтор)`);
    }
  }

  console.log(
    `Готово (${refDate}): отправлено ${sent}, пропущено ${skipped}, ошибок ${failed}, dry-run ${dry}` +
      (live ? "" : " — живая отправка ВЫКЛючена (NOTIFICATIONS_SEND_ENABLED)")
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
