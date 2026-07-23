// ---------------------------------------------------------------------------
// Consistency & honesty guarantees for the «AI-анализ / Уверенность AI» section
// (follow-up to the manager feedback). Covers the required cases from the task:
//   • exact% + mismatch% == 100 over ONE valid-reviewed denominator;
//   • «Недостаточно данных» excluded from that denominator, never a match;
//   • partial is a SUBSET of mismatch, with criterion-level agreement;
//   • «Принято без изменений» == exact set, never inferred from confidence;
//   • low-confidence accepted stays accepted; high-confidence corrected stays
//     corrected; missing AI / missing final never counts as a match.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConfidenceReport } from "../src/lib/confidence-report";
import { classifyMatch } from "../src/lib/match";
import type { Evaluation, EvaluationScores, ReviewStatus } from "../src/lib/types";
import type { AiSnapshot } from "../src/lib/ai";

let seq = 0;
function mk(o: {
  aiTotal?: number | null;
  finalTotal?: number;
  aiCriteria?: Record<string, number>;
  finalCriteria?: Record<string, number>;
  confidence?: number | null;
  status?: ReviewStatus;
  noBaseline?: boolean;
}): Evaluation {
  seq += 1;
  const aiCrit = o.aiCriteria ?? { accuracy: 4, sla: 5 };
  const finalCrit = o.finalCriteria ?? aiCrit;
  const conf = o.confidence === undefined ? 80 : o.confidence;
  const ai: AiSnapshot | undefined = o.noBaseline
    ? undefined
    : { criteria: aiCrit, monthly: {}, total: o.aiTotal ?? 88, confidence: conf ?? 80 };
  return {
    id: `c${seq}`,
    chat_agr_no: `chat${seq}`,
    period: "202607",
    checking_date: "2026-07-10",
    role: "accountant",
    accountant: "Աննա",
    scores: { scheme: "accounting", criteria: finalCrit, monthly: {}, ai },
    total_score: o.finalTotal ?? 88,
    quality_band: "Хорошо",
    comment: null,
    created_at: "2026-07-10T09:00:00.000Z",
    ai_confidence: o.noBaseline ? null : conf,
    ai_total: o.noBaseline ? null : o.aiTotal ?? 88,
    review_status: o.status ?? "accepted",
  };
}

test("exact% + mismatch% == 100 over the same valid-reviewed denominator", () => {
  const evals = [
    mk({ aiTotal: 88, finalTotal: 88, status: "accepted" }), // exact
    mk({ aiTotal: 88, finalTotal: 85, finalCriteria: { accuracy: 3, sla: 5 }, status: "corrected" }), // partial
    mk({ aiTotal: 88, finalTotal: 60, status: "corrected" }), // significant mismatch
  ];
  const r = buildConfidenceReport(evals);
  const m = r.matches;
  assert.equal(m.validReviewed, 3);
  assert.equal(m.exact, 1);
  assert.equal(m.mismatchBroad, 2); // partial + significant
  assert.equal(m.exactPct, 33.3);
  assert.equal(m.mismatchBroadPct, 66.7);
  assert.equal((m.exactPct ?? 0) + (m.mismatchBroadPct ?? 0), 100);
});

test("«Недостаточно данных» is excluded from the denominator and never a match", () => {
  const evals = [
    mk({ aiTotal: 88, finalTotal: 88, status: "accepted" }), // exact, comparable
    mk({ noBaseline: true, status: "corrected" }), // reviewed but no AI snapshot
  ];
  const r = buildConfidenceReport(evals);
  assert.equal(r.matches.validReviewed, 1);
  assert.equal(r.matches.excludedNoBaseline, 1);
  assert.equal(r.matches.exact, 1);
  assert.equal(r.matches.exactPct, 100);
  assert.equal(r.matches.mismatchBroadPct, 0);
});

test("total score matches but one criterion differs → NOT exact (partial), counted as mismatch", () => {
  const evals = [
    mk({
      aiTotal: 88,
      finalTotal: 88,
      aiCriteria: { accuracy: 4, sla: 5 },
      finalCriteria: { accuracy: 3, sla: 5 },
      status: "corrected",
    }),
  ];
  const r = buildConfidenceReport(evals);
  assert.equal(r.matches.exact, 0);
  assert.equal(r.matches.partial, 1);
  assert.equal(r.matches.mismatchBroad, 1);
  assert.equal(r.matches.exactPct, 0);
  assert.equal(r.matches.mismatchBroadPct, 100);
});

test("partial match exposes criterion-level agreement (matched/total)", () => {
  // 3 criteria: 2 match, 1 differs; total within tolerance, same band → partial.
  const evals = [
    mk({
      aiTotal: 88,
      finalTotal: 86,
      aiCriteria: { accuracy: 4, sla: 5, fcr: 5 },
      finalCriteria: { accuracy: 3, sla: 5, fcr: 5 },
      status: "corrected",
    }),
  ];
  const r = buildConfidenceReport(evals);
  assert.equal(r.matches.partial, 1);
  assert.equal(r.matches.partialFieldsTotal, 3);
  assert.equal(r.matches.partialFieldsMatched, 2);
  assert.equal(r.matches.partialFieldsAgreementPct, 66.7);
});

test("all criteria differ + band flips → significant mismatch, not exact", () => {
  const evals = [
    mk({
      aiTotal: 88,
      finalTotal: 55,
      aiCriteria: { accuracy: 5, sla: 5 },
      finalCriteria: { accuracy: 1, sla: 1 },
      status: "corrected",
    }),
  ];
  const r = buildConfidenceReport(evals);
  assert.equal(r.matches.exact, 0);
  assert.equal(r.matches.mismatch, 1); // significant
  assert.equal(r.matches.mismatchBroad, 1);
});

test("missing final Margarita evaluation (not reviewed) is outside validReviewed", () => {
  const evals = [mk({ aiTotal: 88, finalTotal: 88, status: "not_reviewed" })];
  const r = buildConfidenceReport(evals);
  assert.equal(r.reviewed, 0);
  assert.equal(r.matches.validReviewed, 0);
  assert.equal(r.matches.exactPct, null);
  assert.equal(r.acceptedOfReviewedPct, null);
});

test("low-confidence result accepted unchanged stays accepted (confidence NOT inflated)", () => {
  const evals = [mk({ aiTotal: 88, finalTotal: 88, confidence: 35, status: "accepted" })];
  const r = buildConfidenceReport(evals);
  assert.equal(r.accepted, 1);
  assert.equal(r.matches.exact, 1);
  // The stored confidence is echoed as-is — acceptance does not raise it.
  assert.equal(r.rows[0].confidence, 35);
  assert.equal(r.avgConfidenceAccepted, 35);
});

test("high-confidence result corrected stays corrected (a mismatch)", () => {
  const evals = [mk({ aiTotal: 88, finalTotal: 60, confidence: 96, status: "corrected" })];
  const r = buildConfidenceReport(evals);
  assert.equal(r.corrected, 1);
  assert.equal(r.matches.mismatchBroad, 1);
  assert.equal(r.rows[0].confidence, 96);
  assert.equal(r.high.corrected, 1);
});

test("«accepted» is never inferred from confidence: differing fields ⇒ corrected regardless", () => {
  // Very high confidence, but a criterion changed → must be corrected, not accepted.
  const ai: AiSnapshot = { criteria: { accuracy: 5, sla: 5 }, monthly: {}, total: 90, confidence: 99 };
  const finalScores: EvaluationScores = { scheme: "accounting", criteria: { accuracy: 2, sla: 5 }, monthly: {} };
  const m = classifyMatch(ai, finalScores, 90)!;
  assert.notEqual(m.status, "exact"); // fields differ → not an exact/accepted row
  assert.ok(m.criteriaChanged);
});

test("acceptedOfReviewedPct and overallCorrectionPct sum to 100 over reviewed", () => {
  const evals = [
    mk({ aiTotal: 88, finalTotal: 88, status: "accepted" }),
    mk({ aiTotal: 88, finalTotal: 88, status: "accepted" }),
    mk({ aiTotal: 88, finalTotal: 60, status: "corrected" }),
    mk({ aiTotal: 88, finalTotal: 88, status: "not_reviewed" }), // excluded from reviewed
  ];
  const r = buildConfidenceReport(evals);
  assert.equal(r.reviewed, 3);
  assert.equal(r.acceptedOfReviewedPct, 66.7);
  assert.equal(r.overallCorrectionPct, 33.3);
  assert.equal((r.acceptedOfReviewedPct ?? 0) + (r.overallCorrectionPct ?? 0), 100);
});

test("filters change the denominator and the absolute counts together", () => {
  const evals = [
    mk({ aiTotal: 88, finalTotal: 88, status: "accepted", confidence: 95 }),
    mk({ aiTotal: 88, finalTotal: 60, status: "corrected", confidence: 40 }),
  ];
  const all = buildConfidenceReport(evals);
  assert.equal(all.matches.validReviewed, 2);
  const onlyMismatch = buildConfidenceReport(evals, { matchStatus: "mismatch" });
  assert.equal(onlyMismatch.matches.validReviewed, 1);
  assert.equal(onlyMismatch.matches.exact, 0);
});

test("empty/null criteria on both sides do not fabricate a match", () => {
  // No AI baseline at all → classifyMatch returns null (excluded, not a match).
  const finalScores: EvaluationScores = { scheme: "accounting", criteria: {}, monthly: {} };
  assert.equal(classifyMatch(null, finalScores, 88), null);
  assert.equal(classifyMatch(undefined, finalScores, 88), null);
});
