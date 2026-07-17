// Cross-app contract (repo #1 side). The accountant app (kk-accountants-
// feedback-form) does NOT run this codebase — it writes acknowledgements and
// appeals straight into our own tables (mqa_violations / mqa_violation_appeals)
// through SECURITY DEFINER RPCs that produce exactly the row shape our own
// repo.ts functions produce (status new→acknowledged / new→appealed, an appeal
// carrying the violation's accountant, one pending). This test pins the promise
// THIS repo must keep for that integration: once those rows exist, Margarita's
// day report (getViolationWorkflowReport) and the Telegram «Работа Маргариты за
// день» message surface them, and her decision flows back onto the violation.
//
// Runs against the IN-MEMORY store (Supabase not configured in CI), so it
// exercises the full aggregation pipeline end-to-end without a database.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createViolation,
  acknowledgeViolation,
  createViolationAppeal,
  resolveViolationAppeal,
  getViolationWorkflowReport,
  listViolationAppeals,
} from "../src/lib/repo.ts";
import { buildMargaritaWorkReportMessage } from "../src/lib/templates.ts";

// A localized accountant name that does not collide with a seeded employee, so
// the per-accountant row is deterministic in this isolated test process.
const ACC = "Интеграционный Бухгалтер";

async function violationFor(acc = ACC) {
  return createViolation({
    vdate: "2026-07-16",
    accountant: acc,
    chat_agr_no: "B-INT-1",
    client: "Клиент Интеграция",
    severity: "Среднее",
    violation_type: "Долгий ответ",
    sanction: 5000,
    note: "интеграционный тест",
  });
}

test("accountant acknowledge + appeal surface in the day report and Telegram, and the decision flows back", async () => {
  // Accountant reacts to two of their own violations (as the RPCs would).
  const vAck = await violationFor();
  const vAppeal = await violationFor();

  await acknowledgeViolation(vAck.id, ACC); // «Ознакомлен»
  const appeal = await createViolationAppeal(
    { violation_id: vAppeal.id, accountant: ACC, appeal_text: "не согласен с нарушением" },
    ACC
  ); // «Подать апелляцию»
  assert.equal(appeal.status, "pending");

  // Margarita's day report (single source used by /work-report, /dashboard, TG).
  const report = await getViolationWorkflowReport();
  assert.ok(report.acknowledged >= 1, "acknowledgement counted");
  assert.ok(report.appealsSubmitted >= 1, "appeal counted");
  assert.ok(report.appealsPending >= 1, "appeal pending");

  const row = report.byAccountant.find((r) => r.name === ACC);
  assert.ok(row, "the accountant appears in the per-accountant breakdown");
  assert.equal(row!.acknowledgements, 1);
  assert.equal(row!.appealsSubmitted, 1);
  assert.equal(row!.pending, 1);
  assert.equal(row!.unprocessed, 0, "both violations were reacted to");

  // The Telegram «Апелляции и QA Маргариты» message reflects the same numbers.
  // (The in-memory store is seeded, so totals include seed rows — assert on this
  // accountant's own block, which is deterministic.)
  const msg = buildMargaritaWorkReportMessage(report);
  assert.match(msg, /Апелляции и QA Маргариты/);
  const block = [
    `${ACC}:`,
    "- тикетов: 2",
    "- ознакомлен: 1",
    "- апелляций: 1",
    "- подтверждено: 0",
    "- отклонено: 0",
    "- pending: 1",
  ].join("\n");
  assert.ok(msg.includes(block), `per-accountant block present:\n${msg}`);

  // Margarita's decision flows back onto the violation (visible to the accountant
  // via the kk_violation_workflow view in repo #2).
  const resolved = await resolveViolationAppeal(appeal.id, {
    decision: "approved",
    resolvedBy: "margarita@onebusiness.am",
    decisionComment: "согласна, снимаю",
  });
  assert.equal(resolved.status, "approved");

  const after = (await listViolationAppeals({ accountant: ACC }))[0];
  assert.equal(after.status, "approved");
  assert.equal(after.decision_comment, "согласна, снимаю");

  const report2 = await getViolationWorkflowReport();
  assert.ok(report2.appealsApproved >= 1, "approved appeal counted");
  assert.ok(report2.penaltiesCancelled >= 1, "approved violation's fine cancelled in the report");
});

test("ownership: a foreign accountant cannot appeal, so it never enters the report", async () => {
  const v = await violationFor("Владелец Нарушения");
  await assert.rejects(
    () =>
      createViolationAppeal(
        { violation_id: v.id, accountant: "Чужой Бухгалтер", appeal_text: "чужое" },
        "Чужой Бухгалтер"
      ),
    (e: any) => e?.httpStatus === 403
  );
  const report = await getViolationWorkflowReport();
  assert.equal(
    report.byAccountant.find((r) => r.name === "Чужой Бухгалтер"),
    undefined,
    "the non-owner is never attributed an appeal"
  );
});
