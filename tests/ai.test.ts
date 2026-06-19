import { test } from "node:test";
import assert from "node:assert/strict";
import {
  predictEvaluation,
  toSnapshot,
  trainAiModel,
  type AiSnapshot,
} from "../src/lib/ai";
import type { Evaluation } from "../src/lib/types";

function evalRow(over: Partial<Evaluation>): Evaluation {
  return {
    id: Math.random().toString(36).slice(2),
    chat_agr_no: "59",
    period: "202606",
    checking_date: "2026-06-10",
    accountant: "Գայանե",
    scores: {},
    total_score: 100,
    quality_band: "Отлично",
    comment: null,
    created_at: new Date().toISOString(),
    ...over,
  };
}

test("no history: AI predicts full marks and Отлично", () => {
  const model = trainAiModel([]);
  const p = predictEvaluation("Գայանե", {}, model);
  assert.equal(p.criteria.accuracy, 5);
  assert.equal(p.criteria.sla, 5);
  assert.equal(p.total, 100);
  assert.equal(p.band, "Отлично");
});

test("statuses carry over from the previous check; missing ones default to Предстоящая", () => {
  const model = trainAiModel([]);
  const p = predictEvaluation(null, { salary: "Получил" }, model);
  assert.equal(p.monthly.salary.status, "Получил");
  assert.equal(p.monthly.main_taxes.status, "Предстоящая");
});

test("a carried-over failing mailing gates the AI prediction to 1 / Критично", () => {
  const model = trainAiModel([]);
  const p = predictEvaluation("Գայանե", { salary: "Не запросил 1" }, model);
  assert.equal(p.total, 1);
  assert.equal(p.band, "Критично");
});

test("AI learns Margarita's per-accountant criteria pattern", () => {
  // She consistently gives this accountant 4/3 — AI should predict 4/3 (=70).
  const history = [
    evalRow({ scores: { criteria: { accuracy: 4, sla: 3 } }, total_score: 70 }),
    evalRow({ scores: { criteria: { accuracy: 4, sla: 3 } }, total_score: 70 }),
    evalRow({ scores: { criteria: { accuracy: 4, sla: 3 } }, total_score: 70 }),
  ];
  const model = trainAiModel(history);
  const p = predictEvaluation("Գայանե", {}, model);
  assert.equal(p.criteria.accuracy, 4);
  assert.equal(p.criteria.sla, 3);
  assert.equal(p.total, 70);
});

test("another accountant falls back to the global pattern", () => {
  const history = [
    evalRow({ scores: { criteria: { accuracy: 4, sla: 4 } }, total_score: 80 }),
  ];
  const model = trainAiModel(history);
  const p = predictEvaluation("Հասմիկ", {}, model);
  assert.equal(p.criteria.accuracy, 4);
  assert.equal(p.criteria.sla, 4);
});

test("AI corrects itself from stored AI-vs-Margarita pairs (bias)", () => {
  // AI said 100, Margarita said 90 — twice. Learned bias = −10.
  const ai: AiSnapshot = { criteria: { accuracy: 5, sla: 5 }, monthly: {}, total: 100 };
  const history = [
    evalRow({ scores: { ai }, total_score: 90 }),
    evalRow({ scores: { ai }, total_score: 90 }),
  ];
  const model = trainAiModel(history);
  assert.equal(model.trainedPairs, 2);
  const p = predictEvaluation("Գայանե", {}, model);
  assert.equal(p.total, 90);
  assert.equal(p.band, "Отлично");
});

test("bias never pushes the total outside 1..100", () => {
  const ai: AiSnapshot = { criteria: {}, monthly: {}, total: 50 };
  const history = [evalRow({ scores: { ai }, total_score: 100 })]; // bias +50
  const model = trainAiModel(history);
  const p = predictEvaluation("Գայանե", {}, model);
  assert.ok(p.total <= 100, `total ${p.total} must be ≤ 100`);
});

test("gated rows are excluded from bias learning (rule, not judgement)", () => {
  const ai: AiSnapshot = { criteria: {}, monthly: {}, total: 1 };
  const history = [evalRow({ scores: { ai }, total_score: 1, quality_band: "Критично" })];
  const model = trainAiModel(history);
  assert.equal(model.trainedPairs, 0);
});

test("toSnapshot keeps exactly the fields the learner needs", () => {
  const model = trainAiModel([]);
  const p = predictEvaluation("Գայանե", { salary: "Получил" }, model);
  const snap = toSnapshot(p);
  assert.deepEqual(Object.keys(snap).sort(), ["criteria", "monthly", "total"]);
  assert.equal(snap.total, p.total);
});

test("the model is JSON-serializable (server → client prop)", () => {
  const model = trainAiModel([
    evalRow({ scores: { criteria: { accuracy: 4, sla: 5 } }, total_score: 90 }),
  ]);
  const roundTripped = JSON.parse(JSON.stringify(model));
  const a = predictEvaluation("Գայանե", {}, model);
  const b = predictEvaluation("Գայանե", {}, roundTripped);
  assert.deepEqual(a, b);
});

test("facts: debt status auto-fills «Долги» and a failing status gates to 1", () => {
  const model = trainAiModel([]);
  const p = predictEvaluation("Օլյա", {}, model, {
    status: "Active",
    debts: "48000",
    debtStatus: "Не написал 1",
    date: "2026-06-18",
  });
  assert.equal(p.monthly.debts.status, "Не написал 1");
  assert.equal(p.total, 1); // failing mailing gate
  assert.equal(p.band, "Критично");
});

test("facts: deadline before the due day → «Предстоящая»; Inactive client → «Inactive»", () => {
  const model = trainAiModel([]);
  const upcoming = predictEvaluation("Օլյա", {}, model, {
    status: "Active",
    debts: "Нет долга",
    debtStatus: "Нет долга",
    date: "2026-06-10", // before main_taxes due day (15)
  });
  assert.equal(upcoming.monthly.main_taxes.status, "Предстоящая");
  assert.equal(upcoming.monthly.debts.status, "Нет долга");

  const inactive = predictEvaluation("Օլյա", {}, model, {
    status: "Inactive",
    date: "2026-06-20",
  });
  assert.equal(inactive.monthly.main_taxes.status, "Inactive");
});

test("recency: recent evaluations outweigh old ones", () => {
  const history = [
    evalRow({ checking_date: "2026-01-01", scores: { criteria: { accuracy: 5, sla: 5 } } }),
    evalRow({ checking_date: "2026-06-01", scores: { criteria: { accuracy: 2, sla: 2 } } }),
  ];
  const model = trainAiModel(history);
  const p = predictEvaluation("Գայանե", {}, model);
  // The recent 2/2 dominates the 5-month-old 5/5 → prediction is low, not the
  // plain mean (which would round to 4).
  assert.ok(p.criteria.accuracy <= 3, `accuracy ${p.criteria.accuracy} should be low`);
});

test("shrinkage: a 1-sample accountant is pulled toward the global average", () => {
  const history = [
    evalRow({ accountant: "A", scores: { criteria: { accuracy: 2, sla: 2 } } }),
    evalRow({ accountant: "A", scores: { criteria: { accuracy: 2, sla: 2 } } }),
    evalRow({ accountant: "A", scores: { criteria: { accuracy: 2, sla: 2 } } }),
    evalRow({ accountant: "B", scores: { criteria: { accuracy: 5, sla: 5 } } }),
  ];
  const model = trainAiModel(history);
  // B has a single perfect chat, but the global average is ~2.75 → shrunk below 5.
  const b = predictEvaluation("B", {}, model);
  assert.ok(b.criteria.accuracy < 5, `B accuracy ${b.criteria.accuracy} should be shrunk`);
  // A has 3 consistent chats → stays at its own pattern.
  const a = predictEvaluation("A", {}, model);
  assert.equal(a.criteria.accuracy, 2);
});

test("facts path still gates a carried-forward failing mailing", () => {
  const model = trainAiModel([]);
  const p = predictEvaluation("Գայане", { salary: "Не запросил 1" }, model, {
    status: "Active",
    date: "2026-06-18",
  });
  assert.equal(p.total, 1);
});
