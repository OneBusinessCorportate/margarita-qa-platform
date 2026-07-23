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
  /**
   * Число сравнимых структурированных оцениваемых полей между исходной оценкой AI
   * и финалом Маргариты (уникальные критерии ∪ статусы рассылок). Знаменатель для
   * «доли совпавших критериев» частичного совпадения.
   */
  fieldsTotal: number;
  /** Сколько из `fieldsTotal` совпало (одинаковое значение у AI и Маргариты). */
  fieldsMatched: number;
}

/** Count comparable keys (union) and how many carry an equal value. */
function tallyCriteria(
  a: CriteriaScores | undefined,
  b: CriteriaScores | undefined
): { total: number; matched: number } {
  const av = (a ?? {}) as Record<string, number | undefined>;
  const bv = (b ?? {}) as Record<string, number | undefined>;
  const keys = new Set([...Object.keys(av), ...Object.keys(bv)]);
  let matched = 0;
  for (const k of keys) if ((av[k] ?? null) === (bv[k] ?? null)) matched += 1;
  return { total: keys.size, matched };
}

function tallyMonthly(
  ai: Record<string, { status: string }> | undefined,
  final: EvaluationScores["monthly"] | undefined
): { total: number; matched: number } {
  const a = ai ?? {};
  const f = final ?? {};
  const keys = new Set([...Object.keys(a), ...Object.keys(f)]);
  let matched = 0;
  for (const k of keys) {
    if ((a[k]?.status ?? "") === ((f[k]?.status ?? "") as string)) matched += 1;
  }
  return { total: keys.size, matched };
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
  const crit = tallyCriteria(ai.criteria, finalScores.criteria);
  const mon = tallyMonthly(ai.monthly, finalScores.monthly);
  const criteriaChanged = crit.matched !== crit.total;
  const monthlyChanged = mon.matched !== mon.total;
  const fieldsTotal = crit.total + mon.total;
  const fieldsMatched = crit.matched + mon.matched;

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
    fieldsTotal,
    fieldsMatched,
  };
}

/** Median of a numeric list (0 for empty). Pure helper shared by the report. */
export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
