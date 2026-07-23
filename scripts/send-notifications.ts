// ---------------------------------------------------------------------------
// Templated client notifications — the BOT SENDER (pt.3 send + pt.6 log).
//
//   npm run send:notifications                 # send TODAY's due notifications (Yerevan)
//   npm run send:notifications -- --dry-run    # decide + print, send NOTHING, log NOTHING
//   npm run send:notifications -- --date 2026-07-10
//
// Reads the planned 30-day chain (mqa_planned_notifications), and for every row
// due on/before the reference date decides via sendDecision() whether to send.
// A real send posts the row's rendered_text to the CLIENT's chat (chat id from
// mqa_chats.chat_link) and writes the full text to mqa_sent_notifications, then
// marks the planned row 'sent'.
//
// GATED OFF BY DEFAULT (safety). A row is only actually delivered when ALL hold:
//   • its template is approved=true (owner signed off on the wording), AND
//   • NOTIFICATIONS_SEND_ENABLED=1 is set on this cron service, AND
//   • (manual types) a file/mark-done exists for the month.
// Otherwise the row is a "dry-run" (decided + reported, not sent). This mirrors
// the "no-op until configured" posture of the existing Telegram report crons.
//
// Env:
//   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  — read/write the DB
//   TELEGRAM_BOT_TOKEN                                    — the bot token
//   NOTIFICATIONS_SEND_ENABLED                            — "1"/"true" to allow live sends
// ---------------------------------------------------------------------------
import { getServiceClient, isSupabaseConfigured } from "../src/lib/supabase/server";
import { postTelegramMessage, postTelegramDocumentByUrl } from "../src/lib/telegram-core";
import { telegramChatId } from "../src/lib/chat-list";
import { sendDecision, type PlannedStatus } from "../src/lib/notifications";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function sendEnabled(): boolean {
  const v = (process.env.NOTIFICATIONS_SEND_ENABLED || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const refDate = arg("date") || new Date().toISOString().slice(0, 10);

  if (!isSupabaseConfigured()) {
    console.error(
      "Supabase не настроен (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). " +
        "Рассылка уведомлений не запущена."
    );
    process.exit(1);
  }
  const db = getServiceClient()!;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const live = sendEnabled() && !dryRun;

  // Due, still-sendable planned rows.
  const { data: planned, error } = await db
    .from("mqa_planned_notifications")
    .select("*")
    .lte("scheduled_date", refDate)
    .in("status", ["planned", "edited", "approved"] satisfies PlannedStatus[]);
  if (error) throw new Error(`read planned: ${error.message}`);

  const rows = planned ?? [];
  if (rows.length === 0) {
    console.log(`Нет запланированных уведомлений на ${refDate}.`);
    return;
  }

  // Look up templates (approval), chats (active + chat_link), attachments (manual).
  const agrNos = [...new Set(rows.map((r) => r.agr_no))];
  const tplIds = [...new Set(rows.map((r) => r.template_id).filter(Boolean))];

  const [{ data: chats }, { data: tpls }, { data: atts }] = await Promise.all([
    db.from("mqa_chats").select("agr_no, chat_link, status").in("agr_no", agrNos),
    tplIds.length
      ? db.from("mqa_notification_templates").select("id, approved").in("id", tplIds as string[])
      : Promise.resolve({ data: [] as any[] }),
    db.from("mqa_notification_attachments").select("agr_no, period, category, file_url, file_name, marked_done").in("agr_no", agrNos),
  ]);

  const chatBy = new Map((chats ?? []).map((c) => [c.agr_no, c]));
  const tplApproved = new Map((tpls ?? []).map((t) => [t.id, !!t.approved]));
  const attKey = (a: any) => `${a.agr_no}|${a.period}|${a.category}`;
  const attBy = new Map((atts ?? []).map((a) => [attKey(a), a]));

  let sent = 0;
  let dryRunCount = 0;
  let skipped = 0;

  for (const r of rows) {
    const chat = chatBy.get(r.agr_no);
    const chatId = telegramChatId(chat?.chat_link);
    const att = attBy.get(`${r.agr_no}|${r.period}|${r.category}`);
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

    const tag = `${r.agr_no}/${r.category}/${r.subtype} (${r.mode})`;
    if (decision.action === "skip") {
      skipped++;
      console.log(`SKIP  ${tag}: ${decision.reason}`);
      continue;
    }
    if (decision.action === "dry-run") {
      dryRunCount++;
      console.log(`DRY   ${tag} → chat ${chatId}: ${decision.reason}`);
      console.log(`      ${r.rendered_text}`);
      continue;
    }

    // action === "send".
    // Concurrency + partial-failure safety. We CLAIM the row atomically first
    // (conditional UPDATE to 'sent' guarded on a sendable status). Postgres
    // row-locks the UPDATE, so if two runs fire together only ONE claims the row
    // (the other's WHERE no longer matches → 0 rows → skip); no double send.
    const { data: claimed, error: claimErr } = await db
      .from("mqa_planned_notifications")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", r.id)
      .in("status", ["planned", "edited", "approved"])
      .select("id");
    if (claimErr) {
      console.log(`FAIL  ${tag}: не удалось зарезервировать строку: ${claimErr.message}`);
      continue;
    }
    if (!claimed || claimed.length === 0) {
      skipped++;
      console.log(`SKIP  ${tag}: уже обрабатывается/отправлено другим запуском`);
      continue;
    }

    // The full message = template text + the accountant's optional accompanying
    // text (pt.2), used for BOTH the Telegram send and the log's full_text.
    const messageText = r.accompanying_text
      ? `${r.rendered_text}\n\n${r.accompanying_text}`
      : r.rendered_text;

    // Deliver in a SINGLE Telegram call so there is no partial (text-ok /
    // doc-failed) state that a retry would duplicate: with a file the wording
    // rides as the document caption; without a file it is one text message.
    const hasFile = !!att?.file_url;
    const res = hasFile
      ? await postTelegramDocumentByUrl(token!, chatId!, att!.file_url, messageText)
      : await postTelegramMessage(token!, chatId!, messageText);

    // Mandatory log row — written and its result checked (a delivery is never
    // left unlogged).
    const { error: logErr } = await db.from("mqa_sent_notifications").insert({
      agr_no: r.agr_no,
      chat_id: chatId,
      category: r.category,
      subtype: r.subtype,
      language: r.language,
      full_text: hasFile ? `${messageText}\n[вложение: ${att!.file_name || att!.file_url}]` : messageText,
      template_id: r.template_id,
      planned_id: r.id,
      telegram_ok: res.ok,
      telegram_error: res.error ?? null,
    });
    if (logErr) {
      console.log(`WARN  ${tag} → chat ${chatId}: доставка ${res.ok ? "ok" : "нет"}, но журнал не записан: ${logErr.message}`);
    }

    if (res.ok) {
      sent++;
      console.log(`SENT  ${tag} → chat ${chatId}${hasFile ? " (документ+текст)" : ""}`);
    } else {
      // Nothing was delivered (single call failed). REVERT the claim to the
      // original sendable status so the next run retries — no loss, and no
      // duplicate (nothing went out this time).
      await db
        .from("mqa_planned_notifications")
        .update({ status: r.status, sent_at: null })
        .eq("id", r.id)
        .eq("status", "sent");
      console.log(`FAIL  ${tag} → chat ${chatId}: ${res.error} (в журнале, статус возвращён, будет повтор)`);
    }
  }

  console.log(
    `Готово (${refDate}): отправлено ${sent}, пропущено ${skipped}, dry-run ${dryRunCount}${
      live ? "" : " — живая отправка ВЫКЛючена (NOTIFICATIONS_SEND_ENABLED)"
    }.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
