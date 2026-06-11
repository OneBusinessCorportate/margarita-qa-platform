import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BANDS,
  CRITERIA,
  DAILY_CRITERIA,
  FAIL_SCORE,
  MONTHLY_CATEGORIES,
  bandFor,
  computeOverall,
  computeWeightedTotal,
  isMailingFail,
} from "../src/lib/scoring";

test("two criteria, weights 50/50 summing to 100", () => {
  assert.equal(CRITERIA.length, 2);
  assert.deepEqual(CRITERIA.map((c) => c.weight), [50, 50]);
  assert.deepEqual(DAILY_CRITERIA.map((c) => c.id), ["accuracy", "sla"]);
});

test("computeWeightedTotal = score × 50 ÷ 5 per criterion", () => {
  assert.equal(computeWeightedTotal({ accuracy: 5, sla: 5 }), 100);
  assert.equal(computeWeightedTotal({ accuracy: 0, sla: 0 }), 0);
  // 4*50/5 + 3*50/5 = 40 + 30 = 70
  assert.equal(computeWeightedTotal({ accuracy: 4, sla: 3 }), 70);
});

test("computeOverall: un-entered criteria count as full marks", () => {
  assert.equal(computeOverall({ accuracy: 5, sla: 5 }), 100);
  assert.equal(computeOverall({}), 100);
  assert.equal(computeOverall({ accuracy: 4, sla: 5 }), 90);
  assert.equal(computeOverall({ accuracy: 0, sla: 0 }), 0);
});

test("HARD GATE: a failing mailing forces the score to 1", () => {
  const perfect = { accuracy: 5, sla: 5 };
  assert.equal(computeOverall(perfect, { main_taxes: { status: "Не отправил" } }), FAIL_SCORE);
  assert.equal(computeOverall(perfect, { salary: { status: "Не запросил 1" } }), 1);
  assert.equal(computeOverall(perfect, { salary: { status: "Не запросил 2" } }), 1);
  assert.equal(computeOverall(perfect, { primary_docs: { status: "Не запросил 1" } }), 1);
  assert.equal(computeOverall(perfect, { debts: { status: "Не написал 1" } }), 1);
  assert.equal(computeOverall(perfect, { debts: { status: "Не написал 2" } }), 1);
});

test("non-failing statuses do NOT gate the score", () => {
  const perfect = { accuracy: 5, sla: 5 };
  assert.equal(computeOverall(perfect, { salary: { status: "Запросил 1, не получил" } }), 100);
  assert.equal(computeOverall(perfect, { main_taxes: { status: "Отправил" } }), 100);
  assert.equal(computeOverall(perfect, { main_taxes: { status: "Предстоящая" } }), 100);
  assert.equal(computeOverall(perfect, { main_taxes: { status: "Inactive" } }), 100);
  assert.equal(computeOverall(perfect, { debts: { status: "Нет долга" } }), 100);
});

test("isMailingFail detects any failing mailing", () => {
  assert.equal(isMailingFail({ debts: { status: "1-й написал" } }), false);
  assert.equal(isMailingFail({ debts: { status: "Не написал 2" } }), true);
  assert.equal(isMailingFail(undefined), false);
});

test("bandFor maps boundaries; a gated 1 is Критично", () => {
  assert.equal(bandFor(100), "Отлично");
  assert.equal(bandFor(90), "Отлично");
  assert.equal(bandFor(89), "Хорошо");
  assert.equal(bandFor(80), "Хорошо");
  assert.equal(bandFor(79), "Плохо");
  assert.equal(bandFor(60), "Плохо");
  assert.equal(bandFor(59), "Критично");
  assert.equal(bandFor(1), "Критично");
});

test("four mailing categories with correct due days and fail statuses", () => {
  assert.equal(MONTHLY_CATEGORIES.length, 4);
  const byId = Object.fromEntries(MONTHLY_CATEGORIES.map((c) => [c.id, c]));
  assert.equal(byId.main_taxes.dueDay, 15);
  assert.equal(byId.salary.dueDay, 10);
  assert.equal(byId.primary_docs.dueDay, 28);
  assert.equal(byId.debts.dueDay, 5);
  assert.ok(byId.main_taxes.failStatuses.includes("Не отправил"));
  assert.ok(byId.debts.statuses.includes("1-й позвонил"));
  assert.ok(byId.debts.statuses.includes("Нет долга"));
});

test("bands cover 1..100 with no gaps", () => {
  for (let n = 1; n <= 100; n++) {
    const def = BANDS.find((b) => b.band === bandFor(n))!;
    assert.ok(n >= def.min && n <= def.max, `score ${n}`);
  }
});
