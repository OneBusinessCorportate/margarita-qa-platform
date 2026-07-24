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
// Reliability (outbox): reserve BEFORE sending (mqa_reserve_notification_send),
// then send, then record atomically — success via mqa_finalize_notification_sent
// (journal + plan→sent), definitive failure via mqa_fail_notification_send
// (reservation kept as 'failed' → a later run re-arms and retries), ambiguous
// network failure via mqa_hold_notification_send (kept as 'held' → never
// re-sent). A single-run lease is an optimisation only. full_text logs EXACTLY
// the text sent to the client.
//
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN,
//      NOTIFICATIONS_SEND_ENABLED, NOTIFICATIONS_TEST_CHAT_ID.
// ---------------------------------------------------------------------------
import { randomUUID } from "node:crypto";
import { getServiceClient, isSupabaseConfigured } from "../src/lib/supabase/server";
import { postTelegramMessage, postTelegramDocumentByUrl } from "../src/lib/telegram-core";
import { telegramChatId } from "../src/lib/chat-list";
import { planDelivery, capCaption, formatTestMessage, buildTestDailyReport, type PlannedStatus } from "../src/lib/notifications";

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
  // TEST preview: ignore the scheduled-date filter so a manual run always shows
  // something (for a one-off demo). By DEFAULT test mode is date-driven like
  // production — the daily cron sends only what is actually DUE that day, per
  // company, and stays silent on empty days ("send a report … if there is some").
  const preview =
    process.argv.includes("--preview") ||
    /^(1|true|yes)$/i.test((process.env.NOTIFICATIONS_TEST_PREVIEW || "").trim());
  // In TEST mode, cap how many messages go out per run so the single test chat
  // is not flooded. Default 25; set NOTIFICATIONS_TEST_LIMIT to control (e.g. 7).
  const testLimit = testChatId
    ? Math.max(0, Number.parseInt(process.env.NOTIFICATIONS_TEST_LIMIT || "", 10) || 25)
    : Infinity;

  // Single-run lease: bail out if another run holds it (no concurrent delivery).
  // The lease is owned by this token, so we only ever release our own.
  const lockToken = randomUUID();
  const { data: gotLock, error: lockErr } = await db.rpc("mqa_try_acquire_send_lock", {
    p_token: lockToken,
    p_ttl_seconds: 900,
  });
  if (lockErr) throw new Error(`lease: ${lockErr.message}`);
  if (!gotLock) {
    console.log("Другой запуск отправителя ещё выполняется — выходим.");
    return;
  }

  try {
    let query = db
      .from("mqa_planned_notifications")
      .select("*")
      .in("status", ["planned", "edited"] satisfies PlannedStatus[])
      .order("scheduled_date", { ascending: true });
    // Both production and (default) test mode send only what is DUE (scheduled
    // on/before today). Only an explicit --preview / NOTIFICATIONS_TEST_PREVIEW
    // run ignores the date, to demo the plan on a day nothing is due.
    if (!(testChatId && preview)) query = query.lte("scheduled_date", refDate);
    const { data: planned, error } = await query;
    if (error) throw new Error(`read planned: ${error.message}`);
    const rows = planned ?? [];
    if (rows.length === 0) {
      console.log(`Нет запланированных уведомлений на ${refDate}.`);
      return;
    }

    const agrNos = [...new Set(rows.map((r) => r.agr_no))];
    const tplIds = [...new Set(rows.map((r) => r.template_id).filter(Boolean))] as string[];
    const [chatsRes, tplsRes, attsRes] = await Promise.all([
      db.from("mqa_chats").select("agr_no, chat_link, status, name_agr").in("agr_no", agrNos),
      tplIds.length
        ? db.from("mqa_notification_templates").select("id, approved").in("id", tplIds)
        : Promise.resolve({ data: [] as any[], error: null }),
      db.from("mqa_notification_attachments").select("agr_no, period, category, file_url, file_name, marked_done").in("agr_no", agrNos),
    ]);
    // Fail LOUDLY on any read error — never treat a failed read as
    // inactive/unapproved/no-attachment and silently skip urgent notifications.
    if (chatsRes.error) throw new Error(`read chats: ${chatsRes.error.message}`);
    if (tplsRes.error) throw new Error(`read templates: ${tplsRes.error.message}`);
    if (attsRes.error) throw new Error(`read attachments: ${attsRes.error.message}`);
    const chats = chatsRes.data, tpls = tplsRes.data, atts = attsRes.data;
    const chatBy = new Map((chats ?? []).map((c) => [c.agr_no, c]));
    const tplApproved = new Map((tpls ?? []).map((t) => [t.id, !!t.approved]));
    const attBy = new Map((atts ?? []).map((a) => [`${a.agr_no}|${a.period}|${a.category}`, a]));

    let sent = 0, skipped = 0, dry = 0, failed = 0;

    // TEST mode daily report: before the individual messages, post one digest of
    // what is due today, by company — but only if something is due (silent on
    // empty days). Computed from the fresh (not-yet-shown) due rows, same cap.
    if (testChatId) {
      const ids = rows.map((r) => r.id);
      const { data: seenRows, error: seenErr } = ids.length
        ? await db.from("mqa_test_send_log").select("planned_id").in("planned_id", ids)
        : { data: [] as { planned_id: string }[], error: null };
      if (seenErr) throw new Error(`read test log: ${seenErr.message}`);
      const seenSet = new Set((seenRows ?? []).map((s) => s.planned_id));
      const reportItems = rows
        .filter((r) => !seenSet.has(r.id))
        .slice(0, testLimit)
        .map((r) => {
          const c = chatBy.get(r.agr_no);
          return { company: (c?.name_agr || "").trim() || c?.chat_link || r.agr_no, agrNo: r.agr_no, category: r.category };
        });
      const report = buildTestDailyReport(refDate, reportItems);
      if (report && live) {
        const res = await postTelegramMessage(token!, testChatId, report);
        if (!res.ok) console.log(`WARN  отчёт дня не отправлен: ${res.error}`);
      } else if (report) {
        console.log(`DRY   отчёт дня:\n${report}`);
      }
    }

    for (const r of rows) {
      // TEST mode: stop once we've previewed the per-run cap (default/limit).
      if (testChatId && sent >= testLimit) {
        console.log(`Достигнут лимит тест-режима (${testLimit}) — остановка.`);
        break;
      }
      const tag = `${r.agr_no}/${r.category}/${r.subtype} (${r.mode})`;
      const chat = chatBy.get(r.agr_no);
      const company = (chat?.name_agr || "").trim() || chat?.chat_link || r.agr_no;
      const clientChatId = telegramChatId(chat?.chat_link);
      const att = attBy.get(`${r.agr_no}|${r.period}|${r.category}`);

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
      // Only MANUAL notification types carry a document (salary ведомость / tax
      // report). An AUTO type is text-only — never attach a file to it even if an
      // attachment row happens to exist for that (contract, period, category).
      const fileForSend =
        r.mode === "manual" && r.requires_attachment && isHttpUrl(att?.file_url)
          ? (att!.file_url as string)
          : null;
      // full_text logs EXACTLY what was sent to the client (the caption for a
      // document send, capped like Telegram caps it). The attachment itself is
      // recorded separately in mqa_notification_attachments.
      const sentText = fileForSend ? capCaption(messageText) : messageText;

      if (plan.action === "dry-run") {
        dry++; console.log(`DRY   ${tag} → chat ${dest}: ${plan.reason}\n      ${sentText}`); continue;
      }

      const doSend = () => (fileForSend
        ? postTelegramDocumentByUrl(token!, dest, fileForSend, sentText)
        : postTelegramMessage(token!, dest, sentText));

      // TEST mode: preview only. Dedup in a SEPARATE log; NEVER touch the
      // production plan / reservation / journal (so going live still sends to
      // real clients).
      if (testChatId) {
        const { data: seen, error: seenErr } = await db
          .from("mqa_test_send_log").select("planned_id").eq("planned_id", r.id).limit(1);
        if (seenErr) { console.log(`FAIL  ${tag}: тест-журнал недоступен: ${seenErr.message}`); failed++; continue; }
        if (seen && seen.length > 0) { skipped++; console.log(`SKIP  ${tag}: уже показано в тест-чате`); continue; }
        // Prefix the company so the reviewer can tell which client each message
        // is for (all land in one test chat). Real clients never see this.
        const testText = formatTestMessage({ company, agrNo: r.agr_no, category: r.category, body: messageText });
        const res = await (fileForSend
          ? postTelegramDocumentByUrl(token!, dest, fileForSend, capCaption(testText))
          : postTelegramMessage(token!, dest, testText));
        if (res.ok) {
          const { error: upErr } = await db.from("mqa_test_send_log").upsert({ planned_id: r.id, chat_id: dest }, { onConflict: "planned_id" });
          sent++;
          if (upErr) console.log(`WARN  ${tag} → chat ${dest}: доставлено в тест-чат, но не записано (${upErr.message}) — может повториться в след. запуске`);
          else console.log(`TEST  ${tag} → chat ${dest}${fileForSend ? " (+документ)" : ""}`);
        } else { failed++; console.log(`FAIL  ${tag} → chat ${dest}: ${res.error}`); }
        continue;
      }

      // PRODUCTION: reserve BEFORE sending (outbox) so a crash after delivery
      // can never cause a re-send.
      const { data: reservation, error: resErr } = await db.rpc("mqa_reserve_notification_send", { p_planned_id: r.id });
      if (resErr) { console.log(`FAIL  ${tag}: резервирование недоступно: ${resErr.message}`); failed++; continue; }
      if (reservation === "already_delivered") { skipped++; console.log(`SKIP  ${tag}: уже доставлено ранее, статус синхронизирован`); continue; }
      if (reservation === "already_attempted") { skipped++; console.log(`SKIP  ${tag}: уже в обработке/попытке — без повторной отправки`); continue; }

      const res = await doSend();
      if (res.ok) {
        // Atomic: attempt→delivered, clean journal row, plan→sent.
        const { error: finErr } = await db.rpc("mqa_finalize_notification_sent", {
          p_planned_id: r.id, p_agr_no: r.agr_no, p_chat_id: dest, p_category: r.category,
          p_subtype: r.subtype, p_language: r.language, p_full_text: sentText, p_template_id: r.template_id,
        });
        sent++;
        // If finalize failed, the message WAS delivered; the reservation stays
        // (outcome null), so the next run treats it as already-attempted and
        // never re-sends (at-most-once) — only the journal/plan-status may lag.
        if (finErr) console.log(`WARN  ${tag} → chat ${dest}: доставлено, но финализация не записана (${finErr.message}); повтор НЕ будет`);
        else console.log(`SENT  ${tag} → chat ${dest}${fileForSend ? " (+документ)" : ""}`);
      } else if (res.ambiguous) {
        // Ambiguous (network error/timeout — Telegram may have delivered): KEEP
        // the reservation (outcome='held') so we NEVER re-send (at-most-once).
        const { error: holdErr } = await db.rpc("mqa_hold_notification_send", {
          p_planned_id: r.id, p_agr_no: r.agr_no, p_chat_id: dest, p_category: r.category,
          p_subtype: r.subtype, p_language: r.language, p_full_text: sentText, p_template_id: r.template_id,
          p_error: res.error ?? null,
        });
        failed++;
        // Whether or not the hold write succeeded, the reservation stays (null or
        // 'held'), so the next run treats it as already-attempted and never
        // re-sends. Only the audit row may be missing if holdErr.
        console.log(`HOLD  ${tag} → chat ${dest}: ${res.error} (неоднозначно, без повтора — проверить вручную)` +
          (holdErr ? ` [аудит не записан: ${holdErr.message}]` : ""));
      } else {
        // Definitive failure (Telegram returned an error → NOT delivered): mark
        // 'failed' so a later run re-arms and retries. Retry is guaranteed ONLY
        // if this write succeeds; if it fails the row stays reserved (at-most-once).
        const { error: failErr } = await db.rpc("mqa_fail_notification_send", {
          p_planned_id: r.id, p_agr_no: r.agr_no, p_chat_id: dest, p_category: r.category,
          p_subtype: r.subtype, p_language: r.language, p_full_text: sentText, p_template_id: r.template_id,
          p_error: res.error ?? null,
        });
        failed++;
        if (failErr) console.log(`FAIL  ${tag} → chat ${dest}: ${res.error} [не записано: ${failErr.message}; авто-повтор НЕ гарантирован — проверить вручную]`);
        else console.log(`FAIL  ${tag} → chat ${dest}: ${res.error} (не доставлено, будет повтор)`);
      }
    }

    console.log(
      `Готово (${refDate}): отправлено ${sent}, пропущено ${skipped}, ошибок ${failed}, dry-run ${dry}` +
        (testChatId ? ` — ТЕСТ-режим: всё уходит в чат ${testChatId}` : live ? "" : " — живая отправка ВЫКЛючена")
    );
  } finally {
    await db.rpc("mqa_release_send_lock", { p_token: lockToken });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
