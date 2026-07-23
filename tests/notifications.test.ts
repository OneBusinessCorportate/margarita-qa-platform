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

test("isSendable: planned/edited/approved send; cancelled/sent/skipped do not", () => {
  assert.equal(isSendable("planned"), true);
  assert.equal(isSendable("edited"), true);
  assert.equal(isSendable("approved"), true);
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

test("the WILL-be-sent warning is explicit", () => {
  assert.match(WILL_SEND_WARNING, /БУДЕТ отправлено/);
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

test("sendDecision: manual notification without an attachment is skipped", () => {
  const d = sendDecision({
    ...OK,
    mode: "manual",
    requiresAttachment: true,
    hasAttachmentOrDone: false,
  });
  assert.equal(d.action, "skip");
  assert.match(d.reason, /attach/);
  // ...but with a file / mark-done it sends
  assert.equal(
    sendDecision({ ...OK, mode: "manual", requiresAttachment: true, hasAttachmentOrDone: true }).action,
    "send"
  );
});

test("sendDecision: inactive chat / missing chat id / cancelled are skipped", () => {
  assert.equal(sendDecision({ ...OK, chatActive: false }).action, "skip");
  assert.equal(sendDecision({ ...OK, chatId: null }).action, "skip");
  assert.equal(sendDecision({ ...OK, status: "cancelled" }).action, "skip");
});
