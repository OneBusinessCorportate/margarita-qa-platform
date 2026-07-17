import { test } from "node:test";
import assert from "node:assert/strict";
import {
  predictEvaluation,
  predictionConfidenceRaw,
  trainAiModel,
  type ConfidenceFactors,
} from "../src/lib/ai";
import { confidenceDisplay } from "../src/lib/confidence";
import type { Evaluation } from "../src/lib/types";

function evalRow(over: Partial<Evaluation>): Evaluation {
  return {
    id: Math.random().toString(36).slice(2),
    chat_agr_no: "59",
    period: "202606",
    checking_date: "2026-06-10",
    role: "accountant",
    accountant: "A",
    scores: {},
    total_score: 100,
    quality_band: "Отлично",
    comment: null,
    created_at: "2026-06-10T09:00:00.000Z",
    ...over,
  };
}

const base: ConfidenceFactors = {
  accountantIdentified: true,
  effectiveHistory: 10,
  dispersion: 0,
  biasMagnitude: 0,
  gated: false,
  factCompleteness: 1,
};

test("raw confidence never claims 100% (ceiling)", () => {
  assert.ok(predictionConfidenceRaw(base) <= 97);
});

test("raw confidence supports the full low..high range", () => {
  const lowest = predictionConfidenceRaw({
    accountantIdentified: false,
    effectiveHistory: 0,
    dispersion: 1,
    biasMagnitude: 0,
    gated: false,
    factCompleteness: 0,
  });
  // 90%+ is EARNED — it needs deep, consistent history + complete facts.
  const highest = predictionConfidenceRaw({ ...base, effectiveHistory: 40 });
  assert.ok(lowest < 40, `lowest ${lowest} should be low`);
  assert.ok(highest >= 90, `highest ${highest} should be high`);
  assert.ok(highest - lowest > 40, "range must be wide, not clustered");
});

test("ambiguous evidence gives LOWER confidence than clear evidence", () => {
  const ambiguous = predictionConfidenceRaw({
    accountantIdentified: false,
    effectiveHistory: 0,
    dispersion: 1,
    biasMagnitude: 0,
    gated: false,
    factCompleteness: 0.1,
  });
  const clear = predictionConfidenceRaw(base);
  assert.ok(ambiguous < clear);
});

test("inconsistent (high-dispersion) history lowers confidence vs consistent", () => {
  const consistent = predictionConfidenceRaw({ ...base, dispersion: 0 });
  const noisy = predictionConfidenceRaw({ ...base, dispersion: 0.8 });
  assert.ok(noisy < consistent);
});

test("incomplete facts lower confidence", () => {
  const full = predictionConfidenceRaw({ ...base, factCompleteness: 1 });
  const sparse = predictionConfidenceRaw({ ...base, factCompleteness: 0 });
  assert.ok(sparse < full);
});

test("large historical bias penalizes confidence", () => {
  const clean = predictionConfidenceRaw({ ...base, biasMagnitude: 0 });
  const off = predictionConfidenceRaw({ ...base, biasMagnitude: 20 });
  assert.ok(off < clean);
});

test("gated hard-rule row is high-confidence but scaled by fact completeness", () => {
  const gatedFull = predictionConfidenceRaw({ ...base, gated: true, factCompleteness: 1 });
  const gatedThin = predictionConfidenceRaw({ ...base, gated: true, factCompleteness: 0 });
  assert.ok(gatedFull > gatedThin);
  assert.ok(gatedFull >= 85);
});

test("integration: predictEvaluation is NOT clustered at 90-96 across chats", () => {
  // A mix of history depths / consistency produces a spread of confidences.
  const history: Evaluation[] = [];
  for (let i = 0; i < 15; i++)
    history.push(evalRow({ accountant: "Steady", scores: { criteria: { accuracy: 5, sla: 5 } } }));
  // Noisy accountant: scores swing wildly.
  for (let i = 0; i < 15; i++)
    history.push(
      evalRow({ accountant: "Noisy", scores: { criteria: { accuracy: i % 2 ? 5 : 1, sla: i % 2 ? 1 : 5 } } })
    );
  const model = trainAiModel(history);

  const steady = predictEvaluation("Steady", {}, model, { status: "Active", debtStatus: "Нет долга", date: "2026-06-18" });
  const noisy = predictEvaluation("Noisy", {}, model, { status: "Active", debtStatus: "Нет долга", date: "2026-06-18" });
  const unknown = predictEvaluation(null, {}, model);

  assert.ok(steady.confidence > noisy.confidence, "steady should beat noisy");
  assert.ok(noisy.confidence > unknown.confidence, "some history should beat none");
  assert.ok(unknown.confidence < 55, `unknown accountant/no facts should be modest, got ${unknown.confidence}`);
  // rawConfidence and uncertainty are exposed for debugging.
  assert.equal(typeof unknown.rawConfidence, "number");
  assert.ok(unknown.uncertainty.some((u) => u.includes("Бухгалтер не определён")));
});

test("calibration never pushes displayed confidence past the 97% ceiling", () => {
  // A 90-100 bucket that historically ran at 100% accuracy must not yield 98-100.
  const history: Evaluation[] = [];
  for (let i = 0; i < 30; i++)
    history.push(
      evalRow({
        accountant: "Steady",
        scores: { criteria: { accuracy: 5, sla: 5 }, ai: { criteria: {}, monthly: {}, total: 96, confidence: 96 } },
        total_score: 96,
        ai_confidence: 96,
        ai_total: 96,
        review_status: "accepted",
      })
    );
  const model = trainAiModel(history);
  const p = predictEvaluation("Steady", {}, model, { status: "Active", debtStatus: "Нет долга", date: "2026-06-18" });
  assert.ok(p.confidence <= 97, `confidence ${p.confidence} must respect the 97% ceiling`);
});

test("predictEvaluation surfaces evidence-based uncertainty notes", () => {
  const p = predictEvaluation("New", {}, trainAiModel([]));
  assert.ok(p.uncertainty.length > 0);
  // never leaks chain-of-thought — just short evidence phrases
  for (const u of p.uncertainty) assert.ok(u.length < 120);
});

// --- UI display -------------------------------------------------------------

test("confidenceDisplay: missing confidence shows «Недостаточно данных», NOT 90%", () => {
  const d = confidenceDisplay(null);
  assert.equal(d.text, "Недостаточно данных");
  assert.notEqual(d.text, "90%");
  assert.equal(d.tone, "none");
  assert.equal(d.warn, true);
});

test("confidenceDisplay: labels track the ТЗ thresholds", () => {
  assert.equal(confidenceDisplay(30).label, "Низкая уверенность");
  assert.equal(confidenceDisplay(60).label, "Средняя уверенность");
  assert.equal(confidenceDisplay(80).label, "Высокая уверенность");
  assert.equal(confidenceDisplay(95).label, "Очень высокая уверенность");
  assert.equal(confidenceDisplay(30).text, "30%");
});

test("confidenceDisplay: low / incomplete / preliminary use warning styling", () => {
  assert.equal(confidenceDisplay(30).warn, true); // low
  assert.equal(confidenceDisplay(85, { incompleteData: true }).warn, true);
  assert.equal(confidenceDisplay(85, { preliminary: true }).warn, true);
  assert.equal(confidenceDisplay(85).warn, false); // high, complete → no warning
});
