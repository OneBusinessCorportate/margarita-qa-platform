import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConfidenceReport } from "../src/lib/confidence-report";
import type { Evaluation, ReviewStatus } from "../src/lib/types";

let seq = 0;
function mkEval(o: {
  confidence?: number | null;
  status?: ReviewStatus;
  aiTotal?: number;
  accountant?: string;
  date?: string;
  scheme?: string;
  role?: "accountant" | "manager" | "lawyer";
}): Evaluation {
  seq += 1;
  const conf = o.confidence === undefined ? 80 : o.confidence;
  return {
    id: `e${seq}`,
    chat_agr_no: String(seq),
    period: "202607",
    checking_date: o.date ?? "2026-07-10",
    role: o.role ?? "accountant",
    accountant: o.accountant ?? "Աննա",
    scores: {
      scheme: (o.scheme as any) ?? "accounting",
      criteria: { accuracy: 4, sla: 5 },
      ai:
        conf == null && o.aiTotal == null
          ? undefined
          : { criteria: {}, monthly: {}, total: o.aiTotal ?? 88, confidence: conf ?? undefined },
    },
    total_score: 88,
    quality_band: "Хорошо",
    comment: null,
    created_at: "2026-07-10T09:00:00.000Z",
    ai_confidence: conf,
    ai_total: o.aiTotal ?? 88,
    review_status: o.status ?? "accepted",
  };
}

test("counts accepted / corrected / not-reviewed and their percentages", () => {
  const evals = [
    mkEval({ status: "accepted" }),
    mkEval({ status: "accepted" }),
    mkEval({ status: "corrected" }),
    mkEval({ status: "not_reviewed" }),
  ];
  const r = buildConfidenceReport(evals);
  assert.equal(r.total, 4);
  assert.equal(r.accepted, 2);
  assert.equal(r.corrected, 1);
  assert.equal(r.notReviewed, 1);
  assert.equal(r.reviewed, 3);
  assert.equal(r.acceptedPct, 50);
  assert.equal(r.correctedPct, 25);
  assert.equal(r.notReviewedPct, 25);
  // corrected / reviewed = 1/3
  assert.equal(r.overallCorrectionPct, 33.3);
});

test("correction rate by range uses reviewed as the denominator (not total)", () => {
  const evals = [
    // 70–79 range: 1 accepted, 1 corrected, 1 not-reviewed → 1/2 = 50%
    mkEval({ confidence: 75, status: "accepted" }),
    mkEval({ confidence: 72, status: "corrected" }),
    mkEval({ confidence: 78, status: "not_reviewed" }),
  ];
  const r = buildConfidenceReport(evals);
  const range = r.ranges.find((x) => x.id === "70-79")!;
  assert.equal(range.total, 3);
  assert.equal(range.accepted, 1);
  assert.equal(range.corrected, 1);
  assert.equal(range.notReviewed, 1);
  assert.equal(range.reviewed, 2);
  assert.equal(range.correctionPct, 50); // 1 corrected / 2 reviewed, unreviewed excluded
});

test("missing confidence is Нет данных: counted in total, excluded from confidence math", () => {
  const evals = [
    mkEval({ confidence: 95, status: "accepted" }),
    mkEval({ confidence: null, status: "accepted" }), // legacy row, no confidence
  ];
  const r = buildConfidenceReport(evals);
  assert.equal(r.total, 2);
  assert.equal(r.withConfidence, 1);
  assert.equal(r.noConfidence, 1);
  // Only the confidence-bearing row lands in a range bucket.
  const total95 = r.ranges.reduce((s, x) => s + x.total, 0);
  assert.equal(total95, 1);
});

test("average confidence for accepted vs corrected", () => {
  const evals = [
    mkEval({ confidence: 90, status: "accepted" }),
    mkEval({ confidence: 80, status: "accepted" }),
    mkEval({ confidence: 40, status: "corrected" }),
    mkEval({ confidence: 60, status: "corrected" }),
  ];
  const r = buildConfidenceReport(evals);
  assert.equal(r.avgConfidenceAccepted, 85);
  assert.equal(r.avgConfidenceCorrected, 50);
});

test("≥90% metrics and «Точность оценок с уверенностью 90%+»", () => {
  const evals = [
    mkEval({ confidence: 95, status: "accepted" }),
    mkEval({ confidence: 92, status: "accepted" }),
    mkEval({ confidence: 90, status: "corrected" }),
    mkEval({ confidence: 99, status: "not_reviewed" }),
    mkEval({ confidence: 50, status: "corrected" }),
  ];
  const r = buildConfidenceReport(evals);
  assert.equal(r.high.count, 4); // four rows ≥90
  assert.equal(r.high.reviewed, 3); // one of them not reviewed
  assert.equal(r.high.accepted, 2);
  assert.equal(r.high.corrected, 1);
  // accuracy = accepted / reviewed = 2/3
  assert.equal(r.high.accuracyPct, 66.7);
  assert.equal(r.high.correctedPct, 33.3);
});

test("correlation: higher confidence ↔ fewer corrections gives r<0 with n reviewed", () => {
  const evals: Evaluation[] = [];
  for (let i = 0; i < 15; i++) evals.push(mkEval({ confidence: 96, status: "accepted" }));
  for (let i = 0; i < 15; i++) evals.push(mkEval({ confidence: 40, status: "corrected" }));
  const r = buildConfidenceReport(evals);
  assert.equal(r.correlation.n, 30);
  assert.ok(r.correlation.r !== null && r.correlation.r < 0);
  assert.equal(r.correlation.insufficient, false);
  assert.equal(r.correlation.warning, null);
  assert.match(r.correlation.interpretation, /реже/);
});

test("correlation warns when fewer than 30 reviewed evaluations", () => {
  const evals = [
    mkEval({ confidence: 95, status: "accepted" }),
    mkEval({ confidence: 40, status: "corrected" }),
    mkEval({ confidence: 99, status: "not_reviewed" }), // not counted
  ];
  const r = buildConfidenceReport(evals);
  assert.equal(r.correlation.n, 2); // only reviewed with valid confidence
  assert.equal(r.correlation.insufficient, true);
  assert.equal(
    r.correlation.warning,
    "Недостаточно данных для надёжного вывода. Необходимо минимум 30 проверенных оценок."
  );
});

test("filters: status, range, accountant, category and date all narrow the set", () => {
  const evals = [
    mkEval({ confidence: 95, status: "accepted", accountant: "A", date: "2026-07-10" }),
    mkEval({ confidence: 40, status: "corrected", accountant: "B", date: "2026-07-10" }),
    mkEval({ confidence: 95, status: "accepted", accountant: "A", date: "2026-06-10" }),
  ];
  assert.equal(buildConfidenceReport(evals, { status: "corrected" }).total, 1);
  assert.equal(buildConfidenceReport(evals, { confidenceRange: "95-100" }).total, 2);
  assert.equal(buildConfidenceReport(evals, { accountant: "A" }).total, 2);
  assert.equal(buildConfidenceReport(evals, { from: "2026-07-01", to: "2026-07-31" }).total, 2);
  assert.equal(buildConfidenceReport(evals, { category: "registration" }).total, 0);
});

test("only accountant-role rows are in scope (manager/lawyer excluded)", () => {
  const evals = [
    mkEval({ role: "accountant", status: "accepted" }),
    mkEval({ role: "manager", status: "accepted" }),
    mkEval({ role: "lawyer", status: "corrected" }),
  ];
  const r = buildConfidenceReport(evals);
  assert.equal(r.total, 1);
});

test("empty input yields a zeroed report, no crash", () => {
  const r = buildConfidenceReport([]);
  assert.equal(r.total, 0);
  assert.equal(r.overallCorrectionPct, null);
  assert.equal(r.avgConfidenceAccepted, null);
  assert.equal(r.high.accuracyPct, null);
  assert.equal(r.correlation.r, null);
  assert.equal(r.correlation.n, 0);
});

// ---------------------------------------------------------------------------
// Extended metrics: exact/partial/mismatch, score diffs, per-accountant,
// detailed table, second correlation, chat & match-status filters.
// ---------------------------------------------------------------------------

let mseq = 0;
function mkMatch(o: {
  aiTotal: number;
  finalTotal: number;
  aiCriteria?: Record<string, number>;
  finalCriteria?: Record<string, number>;
  confidence?: number;
  status?: ReviewStatus;
  accountant?: string;
  chat?: string;
}): Evaluation {
  mseq += 1;
  const aiCrit = o.aiCriteria ?? { accuracy: 4, sla: 5 };
  const finalCrit = o.finalCriteria ?? aiCrit;
  return {
    id: `m${mseq}`,
    chat_agr_no: o.chat ?? `chat${mseq}`,
    period: "202607",
    checking_date: "2026-07-10",
    role: "accountant",
    accountant: o.accountant ?? "Աննա",
    scores: {
      scheme: "accounting",
      criteria: finalCrit,
      monthly: {},
      ai: { criteria: aiCrit, monthly: {}, total: o.aiTotal, confidence: o.confidence ?? 80 },
    },
    total_score: o.finalTotal,
    quality_band: "Хорошо",
    comment: null,
    created_at: "2026-07-10T09:00:00.000Z",
    ai_confidence: o.confidence ?? 80,
    ai_total: o.aiTotal,
    review_status: o.status ?? "accepted",
  };
}

test("match metrics classify exact / partial / mismatch", () => {
  const evals = [
    mkMatch({ aiTotal: 88, finalTotal: 88, status: "accepted" }), // exact
    mkMatch({ aiTotal: 88, finalTotal: 85, finalCriteria: { accuracy: 3, sla: 5 }, status: "corrected" }), // partial (Δ3, same band)
    mkMatch({ aiTotal: 88, finalTotal: 60, status: "corrected" }), // mismatch (Δ28, band flips)
  ];
  const r = buildConfidenceReport(evals);
  assert.equal(r.matches.comparable, 3);
  assert.equal(r.matches.exact, 1);
  assert.equal(r.matches.partial, 1);
  assert.equal(r.matches.mismatch, 1);
  assert.equal(r.matches.matched, 2);
  assert.equal(r.matches.excludedNoBaseline, 0);
});

test("reviewed rows without an AI baseline are excluded from match stats", () => {
  const noBaseline: Evaluation = {
    ...mkMatch({ aiTotal: 88, finalTotal: 70, status: "corrected" }),
    scores: { scheme: "accounting", criteria: { accuracy: 3 }, monthly: {} }, // no .ai
    ai_total: null,
  };
  const r = buildConfidenceReport([noBaseline]);
  assert.equal(r.matches.comparable, 0);
  assert.equal(r.matches.excludedNoBaseline, 1);
});

test("average and median score difference", () => {
  const evals = [
    mkMatch({ aiTotal: 90, finalTotal: 85, status: "corrected" }), // -5
    mkMatch({ aiTotal: 90, finalTotal: 80, status: "corrected" }), // -10
    mkMatch({ aiTotal: 90, finalTotal: 90, status: "accepted" }), // 0
  ];
  const r = buildConfidenceReport(evals);
  assert.equal(r.matches.avgScoreDiff, -5); // (-5-10+0)/3
  assert.equal(r.matches.medianScoreDiff, -5);
  assert.equal(r.matches.avgAbsScoreDiff, 5);
});

test("per-accountant table aggregates reviews, corrections and 90%+ corrections", () => {
  const evals = [
    mkMatch({ accountant: "A", aiTotal: 90, finalTotal: 90, confidence: 95, status: "accepted" }),
    mkMatch({ accountant: "A", aiTotal: 90, finalTotal: 70, confidence: 95, status: "corrected" }), // 90%+ corrected
    mkMatch({ accountant: "B", aiTotal: 88, finalTotal: 88, confidence: 60, status: "accepted" }),
  ];
  const r = buildConfidenceReport(evals);
  const a = r.byAccountant.find((x) => x.accountant === "A")!;
  assert.equal(a.reviewed, 2);
  assert.equal(a.corrected, 1);
  assert.equal(a.correctionPct, 50);
  assert.equal(a.high90Corrected, 1);
  const b = r.byAccountant.find((x) => x.accountant === "B")!;
  assert.equal(b.corrected, 0);
});

test("detailed table lists corrected/non-exact rows with changed fields", () => {
  const evals = [
    mkMatch({ aiTotal: 88, finalTotal: 88, status: "accepted" }), // exact → not listed
    mkMatch({ aiTotal: 88, finalTotal: 60, status: "corrected", chat: "B-42" }), // mismatch → listed
  ];
  const r = buildConfidenceReport(evals);
  assert.equal(r.detailed.length, 1);
  assert.equal(r.detailed[0].chat, "B-42");
  assert.equal(r.detailed[0].matchStatus, "mismatch");
  assert.ok(r.detailed[0].changedFields.length > 0);
});

test("second correlation: confidence ↔ |score diff|", () => {
  const evals: Evaluation[] = [];
  for (let i = 0; i < 15; i++) evals.push(mkMatch({ aiTotal: 90, finalTotal: 90, confidence: 95, status: "accepted" }));
  for (let i = 0; i < 15; i++) evals.push(mkMatch({ aiTotal: 90, finalTotal: 70, confidence: 40, status: "corrected" }));
  const r = buildConfidenceReport(evals);
  assert.equal(r.correlationScoreDiff.n, 30);
  assert.ok(r.correlationScoreDiff.r !== null && r.correlationScoreDiff.r < 0);
});

test("chat and matchStatus filters narrow the set", () => {
  const evals = [
    mkMatch({ aiTotal: 88, finalTotal: 88, status: "accepted", chat: "X" }), // exact
    mkMatch({ aiTotal: 88, finalTotal: 60, status: "corrected", chat: "Y" }), // mismatch
  ];
  assert.equal(buildConfidenceReport(evals, { chat: "X" }).total, 1);
  assert.equal(buildConfidenceReport(evals, { matchStatus: "mismatch" }).total, 1);
  assert.equal(buildConfidenceReport(evals, { matchStatus: "exact" }).matches.exact, 1);
});

// --- Ключевые показатели калибровки (пп. 3–5) ------------------------------

test("high (≥90%) exposes corrected count and corrected-of-all share (показатель 1)", () => {
  const evals = [
    mkEval({ confidence: 92, status: "corrected" }),
    mkEval({ confidence: 95, status: "corrected" }),
    mkEval({ confidence: 99, status: "corrected" }),
    mkEval({ confidence: 91, status: "accepted" }),
    // <90 must not leak into the high bucket
    mkEval({ confidence: 80, status: "corrected" }),
  ];
  const r = buildConfidenceReport(evals);
  assert.equal(r.high.count, 4);
  assert.equal(r.high.corrected, 3);
  assert.equal(r.high.correctedPct, 75); // 3 corrected / 4 reviewed
});

test("low (<90%) exposes accepted (не исправлено) count and share (показатель 2)", () => {
  const evals = [
    mkEval({ confidence: 80, status: "accepted" }),
    mkEval({ confidence: 60, status: "accepted" }),
    mkEval({ confidence: 70, status: "accepted" }),
    mkEval({ confidence: 55, status: "corrected" }),
    // ≥90 must not leak into the low bucket
    mkEval({ confidence: 95, status: "accepted" }),
  ];
  const r = buildConfidenceReport(evals);
  assert.equal(r.low.count, 4);
  assert.equal(r.low.accepted, 3);
  assert.equal(r.low.corrected, 1);
  assert.equal(r.low.notCorrectedPct, 75); // 3 accepted / 4 reviewed
});

test("closeAgreement: chats where |Margarita − AI| < 5 points, strict boundary (показатель 5)", () => {
  const evals = [
    mkMatch({ aiTotal: 88, finalTotal: 88, status: "accepted" }), // Δ0 → close
    mkMatch({ aiTotal: 88, finalTotal: 85, status: "corrected" }), // Δ3 → close
    mkMatch({ aiTotal: 88, finalTotal: 83, status: "corrected" }), // Δ5 → NOT close (strict <5)
    mkMatch({ aiTotal: 88, finalTotal: 60, status: "corrected" }), // Δ28 → not close
    mkMatch({ aiTotal: 88, finalTotal: 88, status: "not_reviewed" }), // not reviewed → excluded
  ];
  const r = buildConfidenceReport(evals);
  assert.equal(r.closeAgreement.comparable, 4); // reviewed rows with a baseline
  assert.equal(r.closeAgreement.count, 2); // Δ0 and Δ3
  assert.equal(r.closeAgreement.pct, 50); // 2 / 4
});

test("rows carries one drill-down row per evaluation with metric flags", () => {
  const evals = [
    mkMatch({ aiTotal: 88, finalTotal: 88, confidence: 95, status: "corrected" }), // high, closeAgreement
    mkMatch({ aiTotal: 88, finalTotal: 70, confidence: 60, status: "accepted" }), // low, mismatch
  ];
  const r = buildConfidenceReport(evals);
  assert.equal(r.rows.length, 2);
  const a = r.rows.find((x) => x.confidence === 95)!;
  assert.equal(a.high, true);
  assert.equal(a.low, false);
  assert.equal(a.closeAgreement, true);
  assert.equal(a.status, "corrected");
  const b = r.rows.find((x) => x.confidence === 60)!;
  assert.equal(b.low, true);
  assert.equal(b.closeAgreement, false);
  assert.equal(b.matchStatus, "mismatch");
});
