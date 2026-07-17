import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCalibration,
  calibrateConfidence,
  MIN_BUCKET_SAMPLES,
} from "../src/lib/confidence-calibration";
import type { Evaluation, ReviewStatus } from "../src/lib/types";

let seq = 0;
function mkEval(o: {
  confidence?: number | null;
  status?: ReviewStatus;
  date?: string;
  role?: "accountant" | "manager";
}): Evaluation {
  seq += 1;
  return {
    id: `c${seq}`,
    chat_agr_no: String(seq),
    period: "202607",
    checking_date: o.date ?? "2026-07-10",
    role: o.role ?? "accountant",
    accountant: "Աննա",
    scores: { ai: { criteria: {}, monthly: {}, total: 80, confidence: o.confidence ?? undefined } },
    total_score: 80,
    quality_band: "Хорошо",
    comment: null,
    created_at: "2026-07-10T09:00:00.000Z",
    ai_confidence: o.confidence ?? null,
    ai_total: 80,
    review_status: o.status ?? "accepted",
  };
}

test("buildCalibration counts observed accuracy per bucket from real corrections", () => {
  const evals: Evaluation[] = [];
  // 90-94 bucket: 8 accepted, 2 corrected → accuracy 0.8
  for (let i = 0; i < 8; i++) evals.push(mkEval({ confidence: 92, status: "accepted" }));
  for (let i = 0; i < 2; i++) evals.push(mkEval({ confidence: 92, status: "corrected" }));
  const cal = buildCalibration(evals);
  const b = cal.buckets.find((x) => x.id === "90-94")!;
  assert.equal(b.reviewed, 10);
  assert.equal(b.accepted, 8);
  assert.equal(b.corrected, 2);
  assert.equal(b.accuracy, 0.8);
  assert.equal(cal.globalAccuracy, 0.8);
});

test("buildCalibration ignores not-reviewed rows and rows without confidence", () => {
  const cal = buildCalibration([
    mkEval({ confidence: 92, status: "accepted" }),
    mkEval({ confidence: 92, status: "not_reviewed" }), // excluded
    mkEval({ confidence: null, status: "corrected" }), // excluded (no confidence)
    mkEval({ confidence: 92, status: "accepted", role: "manager" }), // out of scope
  ]);
  const b = cal.buckets.find((x) => x.id === "90-94")!;
  assert.equal(b.reviewed, 1);
});

test("buildCalibration `before` cutoff prevents leakage from future rows", () => {
  const cal = buildCalibration(
    [
      mkEval({ confidence: 92, status: "accepted", date: "2026-07-01" }),
      mkEval({ confidence: 92, status: "corrected", date: "2026-07-20" }), // future
    ],
    { before: "2026-07-10" }
  );
  const b = cal.buckets.find((x) => x.id === "90-94")!;
  assert.equal(b.reviewed, 1);
  assert.equal(b.accepted, 1);
});

test("calibrateConfidence: insufficient bucket data returns raw unchanged (preliminary)", () => {
  const cal = buildCalibration([
    mkEval({ confidence: 92, status: "corrected" }),
    mkEval({ confidence: 92, status: "corrected" }),
  ]);
  const out = calibrateConfidence(92, cal);
  assert.equal(out.preliminary, true);
  assert.equal(out.value, 92, "raw must not be inflated when data is thin");
});

test("calibrateConfidence: with enough data, shrinks raw toward observed accuracy", () => {
  const evals: Evaluation[] = [];
  // 90-94 bucket heavily corrected: accuracy 0.4 over 50 rows
  for (let i = 0; i < 20; i++) evals.push(mkEval({ confidence: 92, status: "accepted" }));
  for (let i = 0; i < 30; i++) evals.push(mkEval({ confidence: 92, status: "corrected" }));
  const cal = buildCalibration(evals);
  const out = calibrateConfidence(92, cal);
  assert.equal(out.preliminary, false);
  assert.ok(out.value !== null && out.value < 92, `calibrated ${out.value} should drop below raw 92`);
  assert.ok(out.value! > 40, "shrinkage keeps it above the raw observed 40% floor");
  assert.equal(out.observedAccuracy, 0.4);
});

test("calibrateConfidence: null raw / null calibration → passthrough preliminary", () => {
  assert.equal(calibrateConfidence(null, null).value, null);
  const out = calibrateConfidence(80, null);
  assert.equal(out.value, 80);
  assert.equal(out.preliminary, true);
});

test("MIN_BUCKET_SAMPLES is the documented threshold", () => {
  assert.equal(MIN_BUCKET_SAMPLES, 10);
});
