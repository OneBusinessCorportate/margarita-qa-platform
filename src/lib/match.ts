// ---------------------------------------------------------------------------
// ONE documented, reusable definition of match / partial match / mismatch
// between the ORIGINAL AI evaluation and Margarita's FINAL evaluation.
//
// Pure functions only (no React, no DB) so the repo, the analytics report and
// the tests all share exactly one definition.
//
// Tolerance (documented): total_score is normalised to 0..100 for EVERY scoring
// scheme (Общая оценка), so a single points tolerance is scheme-agnostic. We do
// NOT compare raw criterion grids across schemes — only the normalised total,
// the quality band (category) and the mailing-fail (violation) decision.
//   • exact numeric match  → |score difference| == 0
//   • close (partial)      → |score difference| ≤ SCORE_TOLERANCE (5 points)
//   • significant mismatch → |score difference| >  SCORE_TOLERANCE
// ---------------------------------------------------------------------------

import { bandFor, isMailingFail, type CriteriaScores } from "./scoring";
import type { AiSnapshot } from "./ai";
import type { EvaluationScores } from "./types";

/** Points tolerance on the normalised 0..100 total. Documented above. */
export const SCORE_TOLERANCE = 5;

export type MatchStatus = "exact" | "partial" | "mismatch";

export interface MatchResult {
  status: MatchStatus;
  /** final − ai (signed). */
  scoreDiff: number;
  absScoreDiff: number;
  bandChanged: boolean;
  /** The mailing-fail (violation) decision flipped. */
  gateChanged: boolean;
  criteriaChanged: boolean;
  monthlyChanged: boolean;
  /** Concise RU list of what Margarita changed (for the detailed table). */
  changedFields: string[];
}

function sameCriteria(a: CriteriaScores | undefined, b: CriteriaScores | undefined): boolean {
  const av = (a ?? {}) as Record<string, number | undefined>;
  const bv = (b ?? {}) as Record<string, number | undefined>;
  const keys = new Set([...Object.keys(av), ...Object.keys(bv)]);
  for (const k of keys) if ((av[k] ?? null) !== (bv[k] ?? null)) return false;
  return true;
}

function sameMonthly(
  ai: Record<string, { status: string }> | undefined,
  final: EvaluationScores["monthly"] | undefined
): boolean {
  const a = ai ?? {};
  const f = final ?? {};
  const keys = new Set([...Object.keys(a), ...Object.keys(f)]);
  for (const k of keys) {
    if ((a[k]?.status ?? "") !== ((f[k]?.status ?? "") as string)) return false;
  }
  return true;
}

/**
 * Classify the difference between the original AI snapshot and Margarita's final
 * evaluation. Returns null when there is no AI baseline to compare against — the
 * caller must EXCLUDE such rows from match statistics (do not guess).
 */
export function classifyMatch(
  ai: AiSnapshot | EvaluationScores["ai"] | null | undefined,
  finalScores: EvaluationScores,
  finalTotal: number
): MatchResult | null {
  if (!ai || typeof ai.total !== "number" || Number.isNaN(ai.total)) return null;

  const scoreDiff = finalTotal - ai.total;
  const absScoreDiff = Math.abs(scoreDiff);
  const bandChanged = bandFor(ai.total) !== bandFor(finalTotal);
  const gateChanged = isMailingFail(ai.monthly) !== isMailingFail(finalScores.monthly);
  const criteriaChanged = !sameCriteria(ai.criteria, finalScores.criteria);
  const monthlyChanged = !sameMonthly(ai.monthly, finalScores.monthly);

  const changedFields: string[] = [];
  if (bandChanged) changedFields.push("Категория");
  if (gateChanged) changedFields.push("Решение о нарушении рассылки");
  if (criteriaChanged) changedFields.push("Критерии");
  if (monthlyChanged) changedFields.push("Статусы рассылок");
  if (Math.round(scoreDiff) !== 0) changedFields.push(`Оценка (${scoreDiff > 0 ? "+" : ""}${Math.round(scoreDiff)})`);

  let status: MatchStatus;
  if (!criteriaChanged && !monthlyChanged && Math.round(absScoreDiff) === 0) {
    // Nothing important differs.
    status = "exact";
  } else if (bandChanged || gateChanged || absScoreDiff > SCORE_TOLERANCE) {
    // Category / violation decision flipped, or the score moved beyond tolerance.
    status = "mismatch";
  } else {
    // Same category & decision, score within tolerance, but SOMETHING changed
    // (criteria tweak or a small score adjustment).
    status = "partial";
  }

  return {
    status,
    scoreDiff,
    absScoreDiff,
    bandChanged,
    gateChanged,
    criteriaChanged,
    monthlyChanged,
    changedFields,
  };
}

/** Median of a numeric list (0 for empty). Pure helper shared by the report. */
export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
