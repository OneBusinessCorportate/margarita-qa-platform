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
