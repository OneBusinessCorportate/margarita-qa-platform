// ---------------------------------------------------------------------------
// Confidence CALIBRATION — a real feedback loop from Margarita's corrections.
//
// This is the "learning" the task asks for, and NOTHING MORE: it does NOT retrain
// the external Anthropic model. It is a deterministic, data-driven layer that
// looks at how often past AI evaluations in each confidence bucket were actually
// CORRECTED by Margarita, and maps a raw (evidence-based) confidence to the
// historically-observed accuracy for its bucket.
//
// Guarantees:
//   • No data leakage — calibration is built ONLY from evaluations that already
//     have a frozen `ai_confidence` and a review outcome. When used to adjust a
//     NEW prediction, every historical row is by definition in the past (the new
//     chat has no correction yet). `buildCalibration` also accepts a `before`
//     cutoff for strict point-in-time analysis.
//   • Conservative fallback — a bucket with fewer than MIN_BUCKET_SAMPLES reviewed
//     rows is "preliminary": the raw confidence is returned UNCHANGED (never
//     inflated) and flagged so the UI/report can say so.
//   • Shrinkage — even with enough data, the observed accuracy is blended with
//     the raw value proportional to sample size, so a bucket with 12 rows nudges
//     gently while one with 300 rows dominates.
// ---------------------------------------------------------------------------

import type { Evaluation } from "./types";
import {
  CONFIDENCE_RANGES,
  evaluationConfidence,
  isReviewed,
  rangeOf,
} from "./confidence";

/** A bucket needs at least this many reviewed rows before we trust its rate. */
export const MIN_BUCKET_SAMPLES = 10;
/** Shrinkage strength: observed rate wins only once reviewed ≫ this. */
export const CALIBRATION_SHRINK = 15;

export interface CalibrationBucket {
  id: string;
  label: string;
  min: number;
  max: number;
  /** Reviewed evaluations (accepted+corrected) with a valid confidence here. */
  reviewed: number;
  accepted: number;
  corrected: number;
  /** Observed accuracy = accepted / reviewed (0..1), or null if none reviewed. */
  accuracy: number | null;
  /** True when reviewed < MIN_BUCKET_SAMPLES — the rate is not yet trustworthy. */
  preliminary: boolean;
}

export interface Calibration {
  buckets: CalibrationBucket[];
  totalReviewed: number;
  /** Overall accepted / reviewed across all buckets (conservative fallback). */
  globalAccuracy: number | null;
}

export interface CalibrationOptions {
  /** Only use evaluations strictly BEFORE this ISO date (point-in-time / anti-leakage). */
  before?: string;
}

function inScope(e: Evaluation): boolean {
  return (e.role ?? "accountant") === "accountant";
}

/**
 * Build the calibration table from historical evaluations. Pure — no DB.
 * Only reviewed rows (accepted/corrected) with a valid frozen confidence count.
 */
export function buildCalibration(
  evaluations: Evaluation[],
  opts: CalibrationOptions = {}
): Calibration {
  const buckets: CalibrationBucket[] = CONFIDENCE_RANGES.map((r) => ({
    id: r.id,
    label: r.label,
    min: r.min,
    max: r.max,
    reviewed: 0,
    accepted: 0,
    corrected: 0,
    accuracy: null,
    preliminary: true,
  }));
  const byId = new Map(buckets.map((b) => [b.id, b]));

  let totalReviewed = 0;
  let totalAccepted = 0;

  for (const e of evaluations) {
    if (!inScope(e)) continue;
    if (opts.before && e.checking_date.slice(0, 10) >= opts.before) continue;
    if (!isReviewed(e.review_status)) continue;
    const conf = evaluationConfidence(e);
    if (conf == null) continue;
    const range = rangeOf(conf);
    if (!range) continue;
    const b = byId.get(range.id)!;
    b.reviewed += 1;
    totalReviewed += 1;
    if (e.review_status === "accepted") {
      b.accepted += 1;
      totalAccepted += 1;
    } else {
      b.corrected += 1;
    }
  }

  for (const b of buckets) {
    b.accuracy = b.reviewed > 0 ? b.accepted / b.reviewed : null;
    b.preliminary = b.reviewed < MIN_BUCKET_SAMPLES;
  }

  return {
    buckets,
    totalReviewed,
    globalAccuracy: totalReviewed > 0 ? totalAccepted / totalReviewed : null,
  };
}

export interface CalibratedConfidence {
  /** Calibrated confidence 0..100 (or null when raw is null). */
  value: number | null;
  /** Raw (pre-calibration) confidence echoed back. */
  raw: number | null;
  /** True when the bucket lacked enough data — value == raw, not adjusted. */
  preliminary: boolean;
  /** Reviewed rows in the matched bucket (for transparency). */
  bucketReviewed: number;
  /** Observed accuracy of the matched bucket (0..1), or null. */
  observedAccuracy: number | null;
}

/**
 * Map a raw confidence to the historically-observed accuracy of its bucket.
 * Conservative: an under-sampled bucket returns the raw value unchanged (flagged
 * preliminary), never an inflated one. Otherwise the raw value is shrunk toward
 * the observed accuracy in proportion to how much data backs the bucket.
 */
export function calibrateConfidence(
  raw: number | null | undefined,
  calibration: Calibration | null | undefined
): CalibratedConfidence {
  const rawVal = typeof raw === "number" && !Number.isNaN(raw) ? raw : null;
  if (rawVal == null || !calibration) {
    return { value: rawVal, raw: rawVal, preliminary: true, bucketReviewed: 0, observedAccuracy: null };
  }
  const bucket = calibration.buckets.find((b) => rawVal >= b.min && rawVal <= b.max);
  const reviewed = bucket?.reviewed ?? 0;
  const observed = bucket?.accuracy ?? null;
  if (!bucket || reviewed < MIN_BUCKET_SAMPLES || observed == null) {
    // Not enough evidence to adjust — keep the honest raw value, flag preliminary.
    return {
      value: rawVal,
      raw: rawVal,
      preliminary: true,
      bucketReviewed: reviewed,
      observedAccuracy: observed,
    };
  }
  const observedPct = observed * 100;
  const weight = reviewed / (reviewed + CALIBRATION_SHRINK);
  const value = Math.round(rawVal * (1 - weight) + observedPct * weight);
  return {
    value: Math.max(0, Math.min(100, value)),
    raw: rawVal,
    preliminary: false,
    bucketReviewed: reviewed,
    observedAccuracy: observed,
  };
}
