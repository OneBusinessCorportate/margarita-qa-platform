import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyMatch, median, SCORE_TOLERANCE } from "../src/lib/match";
import type { AiSnapshot } from "../src/lib/ai";
import type { EvaluationScores } from "../src/lib/types";

function ai(over: Partial<AiSnapshot> = {}): AiSnapshot {
  return {
    criteria: { accuracy: 4, sla: 5 },
    monthly: { main_taxes: { status: "Отправил" } },
    total: 88,
    confidence: 80,
    ...over,
  };
}
function fin(over: Partial<EvaluationScores> = {}): EvaluationScores {
  return {
    criteria: { accuracy: 4, sla: 5 },
    monthly: { main_taxes: { status: "Отправил", prev: "--" } },
    ...over,
  };
}

test("exact: identical criteria, monthly and score", () => {
  const m = classifyMatch(ai(), fin(), 88)!;
  assert.equal(m.status, "exact");
  assert.equal(m.scoreDiff, 0);
  assert.equal(m.changedFields.length, 0);
});

test("partial: same band & gate, score within tolerance, criterion tweaked", () => {
  const m = classifyMatch(ai({ total: 88 }), fin({ criteria: { accuracy: 3, sla: 5 } }), 85)!;
  assert.equal(m.status, "partial");
  assert.equal(m.absScoreDiff, 3);
  assert.ok(m.criteriaChanged);
  assert.ok(m.changedFields.includes("Критерии"));
});

test("partial boundary: exactly SCORE_TOLERANCE points, same band, is partial", () => {
  // 88 → 83, both «Хорошо» (80–89), gate unchanged, diff = 5 (== tolerance).
  const m = classifyMatch(ai({ total: 88 }), fin(), 88 - SCORE_TOLERANCE)!;
  assert.equal(m.absScoreDiff, SCORE_TOLERANCE);
  assert.equal(m.status, "partial");
});

test("mismatch: score moves beyond tolerance", () => {
  const m = classifyMatch(ai({ total: 88 }), fin(), 70)!;
  assert.equal(m.status, "mismatch");
  assert.equal(m.absScoreDiff, 18);
});

test("mismatch: mailing-fail (gate) decision flips", () => {
  const m = classifyMatch(
    ai({ monthly: { salary: { status: "Получил" } }, total: 88 }),
    fin({ monthly: { salary: { status: "Не запросил 1", prev: "--" } } }),
    88
  )!;
  assert.equal(m.gateChanged, true);
  assert.equal(m.status, "mismatch");
  assert.ok(m.changedFields.includes("Решение о нарушении рассылки"));
});

test("mismatch: quality band (category) changes even within tolerance", () => {
  // 58 (Критично 1–59) → 62 (Плохо 60–79): only 4 points, but the band flips.
  const m = classifyMatch(ai({ total: 58 }), fin(), 62)!;
  assert.equal(m.absScoreDiff, 4);
  assert.ok(m.bandChanged);
  assert.equal(m.status, "mismatch");
});

test("null when there is no AI baseline (excluded, never guessed)", () => {
  assert.equal(classifyMatch(null, fin(), 88), null);
  assert.equal(classifyMatch(undefined, fin(), 88), null);
  assert.equal(classifyMatch({ criteria: {}, monthly: {} } as AiSnapshot, fin(), 88), null);
});

test("median: odd and even", () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), 0);
});

test("SCORE_TOLERANCE is the documented 5 points", () => {
  assert.equal(SCORE_TOLERANCE, 5);
});

test("field counts: exact match reports all fields matched", () => {
  const m = classifyMatch(
    ai({ criteria: { accuracy: 4, sla: 5 }, monthly: { main_taxes: { status: "Отправил" } } }),
    fin({ criteria: { accuracy: 4, sla: 5 }, monthly: { main_taxes: { status: "Отправил", prev: "--" } } }),
    88
  )!;
  assert.equal(m.fieldsTotal, 3); // accuracy + sla + main_taxes
  assert.equal(m.fieldsMatched, 3);
});

test("field counts: one criterion differs → matched = total − 1", () => {
  const m = classifyMatch(
    ai({ criteria: { accuracy: 4, sla: 5 } }),
    fin({ criteria: { accuracy: 3, sla: 5 } }),
    85
  )!;
  assert.equal(m.fieldsTotal, 3); // accuracy + sla + main_taxes (from fin default monthly)
  assert.equal(m.fieldsMatched, 2); // sla + main_taxes match, accuracy differs
});
