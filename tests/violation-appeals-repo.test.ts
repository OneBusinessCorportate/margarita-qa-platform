// End-to-end exercise of the violation workflow against the IN-MEMORY store
// (Supabase not configured in CI), proving the fallback backend implements the
// same rules as production: acknowledge, appeal, decide, and all the guards.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acknowledgeViolation,
  createViolation,
  createViolationAppeal,
  getViolation,
  listViolationAppealsFor,
  resolveViolationAppeal,
} from "../src/lib/repo.ts";
import { WorkflowError } from "../src/lib/violation-workflow.ts";

async function freshViolation(accountant = "Օլյա") {
  return createViolation({
    vdate: "2026-07-16",
    accountant,
    chat_agr_no: "B-777",
    client: "Тест Клиент",
    severity: "Среднее",
    violation_type: "Долгий ответ",
    note: "тест",
  });
}

test("acknowledge is idempotent and persists", async () => {
  const v = await freshViolation();
  assert.equal(v.status, "new");
  const a1 = await acknowledgeViolation(v.id, "Օլյա");
  assert.equal(a1.status, "acknowledged");
  assert.ok(a1.acknowledged_at);
  const a2 = await acknowledgeViolation(v.id, "Օլյա");
  assert.equal(a2.status, "acknowledged");
  assert.equal(a2.acknowledged_at, a1.acknowledged_at, "no duplicate/overwrite");
});

test("appeal moves the violation to appealed and blocks a second pending appeal", async () => {
  const v = await freshViolation();
  const appeal = await createViolationAppeal(
    { violation_id: v.id, accountant: "Օլյա", appeal_text: "не согласен" },
    "Օլյա"
  );
  assert.equal(appeal.status, "pending");
  const after = await getViolation(v.id);
  assert.equal(after!.status, "appealed");
  assert.equal(after!.appeal_status, "appealed");

  await assert.rejects(
    () => createViolationAppeal({ violation_id: v.id, accountant: "Օլյա", appeal_text: "ещё раз" }, "Օլյա"),
    (e) => e instanceof WorkflowError && e.httpStatus === 409
  );
  assert.equal((await listViolationAppealsFor(v.id)).length, 1);
});

test("an accountant cannot appeal someone else's violation", async () => {
  const v = await freshViolation("Օլյա");
  await assert.rejects(
    () => createViolationAppeal({ violation_id: v.id, accountant: "Դավիթ", appeal_text: "чужое" }, "Դավիթ"),
    (e) => e instanceof WorkflowError && e.httpStatus === 403
  );
});

test("approve resolves the appeal, updates the violation, and cannot be repeated", async () => {
  const v = await freshViolation();
  const appeal = await createViolationAppeal(
    { violation_id: v.id, accountant: "Օլյա", appeal_text: "прошу пересмотреть" },
    "Օլյա"
  );
  const resolved = await resolveViolationAppeal(appeal.id, {
    decision: "approved",
    resolvedBy: "margarita@onebusiness.am",
    decisionComment: "согласна",
  });
  assert.equal(resolved.status, "approved");
  assert.ok(resolved.resolved_at);
  const after = await getViolation(v.id);
  assert.equal(after!.status, "appeal_approved");
  assert.equal(after!.appeal_status, "approved");

  await assert.rejects(
    () => resolveViolationAppeal(appeal.id, { decision: "rejected" }),
    (e) => e instanceof WorkflowError && e.httpStatus === 409
  );
});

test("reject keeps the violation in force", async () => {
  const v = await freshViolation();
  const appeal = await createViolationAppeal(
    { violation_id: v.id, accountant: "Օլյա", appeal_text: "не согласен" },
    "Օլյա"
  );
  await resolveViolationAppeal(appeal.id, { decision: "rejected", decisionComment: "нет" });
  const after = await getViolation(v.id);
  assert.equal(after!.status, "appeal_rejected");
  assert.equal(after!.appeal_status, "rejected");
});

test("acknowledging an unknown violation is a 404", async () => {
  await assert.rejects(
    () => acknowledgeViolation("does-not-exist"),
    (e) => e instanceof WorkflowError && e.httpStatus === 404
  );
});
