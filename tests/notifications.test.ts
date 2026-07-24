// Pure spec for the templated-notifications planning/rendering logic. Runs
// DB-free; keeps the TS spec in parity with the SQL planning function
// (mqa_plan_notifications) and the shared cycle arithmetic (scoring.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NOTIFICATION_PLAN,
  renderTemplate,
  scheduledDateFor,
  planPeriodOf,
  isSendable,
  pickTemplate,
  templateId,
  sendDecision,
  planDelivery,
  capCaption,
  parseDebtAmount,
  owesServices,
  categoryLabel,
  formatTestMessage,
  buildTestDailyReport,
  TELEGRAM_CAPTION_LIMIT,
  WILL_SEND_WARNING,
} from "../src/lib/notifications.ts";

const OK = {
  status: "planned" as const,
  mode: "auto" as const,
  requiresAttachment: false,
  templateApproved: true,
  hasAttachmentOrDone: false,
  chatActive: true,
  chatId: "-100123",
  sendEnabled: true,
};

test("plan covers every category exactly once with a matching mode", () => {
  const cats = NOTIFICATION_PLAN.map((p) => p.category).sort();
  assert.deepEqual(cats, ["debts", "main_taxes", "primary_docs", "salary"]);
  const byCat = Object.fromEntries(NOTIFICATION_PLAN.map((p) => [p.category, p]));
  // Task-stated split: debts/primary_docs AUTO, salary/main_taxes MANUAL.
  assert.equal(byCat.debts.mode, "auto");
  assert.equal(byCat.primary_docs.mode, "auto");
  assert.equal(byCat.salary.mode, "manual");
  assert.equal(byCat.main_taxes.mode, "manual");
  // MANUAL types require an attachment (file / mark) before sending.
  assert.equal(byCat.salary.requiresAttachment, true);
  assert.equal(byCat.main_taxes.requiresAttachment, true);
  assert.equal(byCat.debts.requiresAttachment, false);
});

test("renderTemplate substitutes supported placeholders and leaves unknowns", () => {
  const out = renderTemplate(
    "Клиент {client}, договор {contract}, до {due_day} числа. {unknown}",
    { client: "ООО Ромашка", contract: "B-3302", dueDay: 10 }
  );
  assert.equal(out, "Клиент ООО Ромашка, договор B-3302, до 10 числа. {unknown}");
});

test("renderTemplate fills company/amount/month/hvhh and {client} falls back to {company}", () => {
  const out = renderTemplate(
    "{company} (ИНН {hvhh}), за {month}. Сумма: {amount} драм. Привет, {client}!",
    { company: "BLUE PEAK DIGITAL LLC", hvhh: "00545384", month: "июня", amount: 24000 }
  );
  assert.equal(out, "BLUE PEAK DIGITAL LLC (ИНН 00545384), за июня. Сумма: 24000 драм. Привет, BLUE PEAK DIGITAL LLC!");
});

test("scheduledDateFor uses this month when the due day is ahead, else next", () => {
  const ref = new Date(Date.UTC(2026, 6, 3)); // 2026-07-03
  // due day 10 is still ahead in July
  assert.equal(scheduledDateFor(10, ref).toISOString().slice(0, 10), "2026-07-10");
  // due day 1 already passed → August
  assert.equal(scheduledDateFor(1, ref).toISOString().slice(0, 10), "2026-08-01");
});

test("planPeriodOf reuses the mailing-cycle rollover (28th → next month)", () => {
  // до-28 primary docs land in the NEXT month's cycle.
  assert.equal(planPeriodOf(new Date(Date.UTC(2026, 6, 28))), "202608");
  assert.equal(planPeriodOf(new Date(Date.UTC(2026, 6, 10))), "202607");
});

test("isSendable: only planned/edited send (no approve/cancel step)", () => {
  assert.equal(isSendable("planned"), true);
  assert.equal(isSendable("edited"), true);
  assert.equal(isSendable("approved"), false);
  assert.equal(isSendable("cancelled"), false);
  assert.equal(isSendable("sent"), false);
  assert.equal(isSendable("skipped"), false);
});

test("pickTemplate falls back to Russian and skips inactive", () => {
  const tpls = [
    { language: "ru" as const, active: true, id: "r" },
    { language: "hy" as const, active: false, id: "h" },
  ];
  assert.equal(pickTemplate(tpls, "hy")?.id, "r"); // hy inactive → ru fallback
  assert.equal(pickTemplate(tpls, "ru")?.id, "r");
  assert.equal(pickTemplate([], "ru"), null);
});

test("templateId shape matches the catalog primary key", () => {
  assert.equal(templateId("salary", "done", "ru"), "salary:done:ru");
});

test("parseDebtAmount / owesServices: positive owes; negative & non-numeric do NOT", () => {
  assert.equal(parseDebtAmount("24000"), 24000);
  assert.equal(parseDebtAmount("24 000"), 24000);
  assert.equal(parseDebtAmount("Нет долга"), null);
  assert.equal(parseDebtAmount(""), null);
  assert.equal(parseDebtAmount(null), null);
  // a negative debt (credit / overpaid) must stay negative, NOT flip positive
  assert.equal(parseDebtAmount("-5000"), -5000);
  assert.equal(owesServices("24000"), true);
  assert.equal(owesServices("-5000"), false); // no reminder for a credit
  assert.equal(owesServices("0"), false);
  assert.equal(owesServices("Нет долга"), false);
});

test("the WILL-be-sent warning is explicit (and states no cancel)", () => {
  assert.match(WILL_SEND_WARNING, /БУДЕТ отправлено/);
  assert.match(WILL_SEND_WARNING, /Отменить/);
});

test("sendDecision: happy path sends", () => {
  assert.equal(sendDecision(OK).action, "send");
});

test("sendDecision: gated OFF → dry-run, not send", () => {
  assert.equal(sendDecision({ ...OK, sendEnabled: false }).action, "dry-run");
});

test("sendDecision: unapproved wording is skipped even when send is enabled", () => {
  const d = sendDecision({ ...OK, templateApproved: false });
  assert.equal(d.action, "skip");
  assert.match(d.reason, /not approved/);
});

test("sendDecision: manual without attachment is skipped; with a file/mark it sends", () => {
  assert.equal(
    sendDecision({ ...OK, mode: "manual", requiresAttachment: true, hasAttachmentOrDone: false }).action,
    "skip"
  );
  assert.equal(
    sendDecision({ ...OK, mode: "manual", requiresAttachment: true, hasAttachmentOrDone: true }).action,
    "send"
  );
});

test("sendDecision: inactive chat / missing id / non-sendable status are skipped", () => {
  assert.equal(sendDecision({ ...OK, chatActive: false }).action, "skip");
  assert.equal(sendDecision({ ...OK, chatId: null }).action, "skip");
  assert.equal(sendDecision({ ...OK, status: "sent" }).action, "skip");
  assert.equal(sendDecision({ ...OK, status: "approved" }).action, "skip");
});

test("capCaption truncates to the Telegram caption limit, so the log == what was sent", () => {
  const long = "x".repeat(TELEGRAM_CAPTION_LIMIT + 50);
  assert.equal(capCaption(long).length, TELEGRAM_CAPTION_LIMIT);
  assert.equal(capCaption("короткий"), "короткий");
});

test("planDelivery: test-chat mode redirects EVERY sendable row to the test chat, bypassing gates", () => {
  const base = { ...OK, clientChatId: "-100client", testChatId: "-100test" };
  // unapproved + manual-without-file would be skipped in production, but in test
  // mode they still go — to the TEST chat.
  const p = planDelivery({ ...base, templateApproved: false, mode: "manual", requiresAttachment: true, hasAttachmentOrDone: false });
  assert.equal(p.action, "send");
  assert.equal(p.chatId, "-100test");
  // a non-sendable status is still not sent
  assert.equal(planDelivery({ ...base, status: "sent" }).action, "skip");
});

test("planDelivery: test-chat mode STILL honours dry-run (never actually sends)", () => {
  const p = planDelivery({ ...OK, clientChatId: "-100client", testChatId: "-100test", sendEnabled: false });
  assert.equal(p.action, "dry-run");
  assert.equal(p.chatId, "-100test");
});

test("categoryLabel maps known categories and falls back to the raw key", () => {
  assert.equal(categoryLabel("debts"), "Оплата услуг");
  assert.equal(categoryLabel("salary"), "Зарплата");
  assert.equal(categoryLabel("main_taxes"), "Налоги");
  assert.equal(categoryLabel("primary_docs"), "Первичные документы");
  assert.equal(categoryLabel("unknown_cat"), "unknown_cat");
});

test("formatTestMessage prefixes the company/contract/category so the test chat is readable", () => {
  const out = formatTestMessage({ company: "BLUE PEAK DIGITAL LLC", agrNo: "B-4219", category: "debts", body: "текст" });
  assert.equal(out, "🏢 BLUE PEAK DIGITAL LLC · B-4219 · Оплата услуг\n\nтекст");
});

test("buildTestDailyReport lists what is due by company, and is null when nothing is due", () => {
  assert.equal(buildTestDailyReport("2026-07-24", []), null);
  const r = buildTestDailyReport("2026-07-24", [
    { company: "Ромашка", agrNo: "B-1", category: "debts" },
    { company: "Ромашка", agrNo: "B-1", category: "salary" },
    { company: "Лютик", agrNo: "B-2", category: "primary_docs" },
  ]);
  assert.match(r!, /Рассылка за 2026-07-24/);
  assert.match(r!, /3 уведомл\. по 2 комп\./); // 3 items, 2 distinct contracts
  assert.match(r!, /Ромашка \(B-1\) — Оплата услуг/);
  assert.match(r!, /Лютик \(B-2\) — Первичные документы/);
});

test("planDelivery: production mode (no test chat) uses the full gate + client chat", () => {
  const base = { ...OK, clientChatId: "-100client", testChatId: null };
  const ok = planDelivery(base);
  assert.equal(ok.action, "send");
  assert.equal(ok.chatId, "-100client");
  assert.equal(planDelivery({ ...base, templateApproved: false }).action, "skip");
  assert.equal(planDelivery({ ...base, sendEnabled: false }).action, "dry-run");
});
