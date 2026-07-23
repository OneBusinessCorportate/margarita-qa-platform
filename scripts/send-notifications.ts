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
    // Idempotency: CLAIM the row first (atomic conditional update to 'sent').
    // Only a row still in a sendable status is claimed, so a DB failure after a
    // successful Telegram call, a partial text/document failure, or a concurrent
    // cron run can never cause a DUPLICATE client message (at-most-once). A row
    // that another run already claimed returns nothing here and is skipped.
    const nowIso = new Date().toISOString();
    const { data: claimed, error: claimErr } = await db
      .from("mqa_planned_notifications")
      .update({ status: "sent", sent_at: nowIso })
      .eq("id", r.id)
      .in("status", ["planned", "edited", "approved"])
      .select("id");
    if (claimErr) {
      console.log(`FAIL  ${tag}: не удалось зарезервировать строку: ${claimErr.message}`);
      continue;
    }
    if (!claimed || claimed.length === 0) {
      skipped++;
      console.log(`SKIP  ${tag}: уже обработано другим запуском`);
      continue;
    }

    // Send WITHOUT duplicating the text. With an attached file the wording rides
    // as the document's caption (one message); only when the text is too long
    // for a caption (>1024) do we send the text once and the file separately.
    const errs: string[] = [];
    let ok = true;
    const hasFile = !!att?.file_url;
    const textFitsCaption = (r.rendered_text ?? "").length <= 1024;
    if (hasFile && textFitsCaption) {
      const docRes = await postTelegramDocumentByUrl(token!, chatId!, att!.file_url, r.rendered_text);
      ok = docRes.ok;
      if (!docRes.ok && docRes.error) errs.push(docRes.error);
    } else {
      const textRes = await postTelegramMessage(token!, chatId!, r.rendered_text);
      ok = textRes.ok;
      if (!textRes.ok && textRes.error) errs.push(textRes.error);
      if (hasFile) {
        const docRes = await postTelegramDocumentByUrl(token!, chatId!, att!.file_url);
        ok = ok && docRes.ok;
        if (!docRes.ok && docRes.error) errs.push(`документ: ${docRes.error}`);
      }
    }

    await db.from("mqa_sent_notifications").insert({
      agr_no: r.agr_no,
      chat_id: chatId,
      category: r.category,
      subtype: r.subtype,
      language: r.language,
      full_text: hasFile ? `${r.rendered_text}\n[вложение: ${att!.file_name || att!.file_url}]` : r.rendered_text,
      template_id: r.template_id,
      planned_id: r.id,
      telegram_ok: ok,
      telegram_error: errs.length ? errs.join("; ") : null,
    });
    if (ok) {
      sent++;
      console.log(`SENT  ${tag} → chat ${chatId}${hasFile ? " (+документ)" : ""}`);
    } else {
      // The row is already claimed as 'sent' (at-most-once); the failure is
      // recorded in mqa_sent_notifications for manual follow-up. We deliberately
      // do NOT auto-retry, to avoid sending the client a duplicate.
      console.log(`FAIL  ${tag} → chat ${chatId}: ${errs.join("; ")} (залогировано, без авто-повтора)`);
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
