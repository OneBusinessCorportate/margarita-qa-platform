// ---------------------------------------------------------------------------
// Self-learning AI evaluator.
//
// The AI fills the SAME fields as Margarita (Точность, СЛА, статусы рассылок,
// Общая, Кач-во) by analysing the data already in Supabase: the chat's status
// history and Margarita's past evaluations. Every time she saves her own row,
// the AI's snapshot is stored alongside it (scores.ai), so the next training
// pass can compare "what AI said" vs "what Margarita said" and correct itself:
//
//   • criteria (Точн./СЛА): per-accountant running averages of HER scores —
//     if she consistently gives an accountant 4s, the AI starts predicting 4;
//   • total: a learned bias = mean(her total − AI total) over past pairs,
//     applied per accountant (falling back to the global bias).
//
// Everything is a pure function of the evaluation list, so the model retrains
// from the source of truth on every page load — no separate training state.
// When the Telegram bot feed adds chat text, an LLM can replace predictCriteria
// while the calibration layer keeps learning from Margarita the same way.
// ---------------------------------------------------------------------------

import {
  CRITERIA,
  MONTHLY_CATEGORIES,
  bandFor,
  computeOverall,
  isMailingFail,
  type CriteriaScores,
  type CriterionId,
  type QualityBand,
} from "./scoring";
import type { Evaluation } from "./types";

export interface AiPrediction {
  criteria: CriteriaScores;
  monthly: Record<string, { status: string }>;
  total: number;
  band: QualityBand;
  /** Short human explanation of where the numbers came from. */
  note: string;
}

/** Snapshot persisted in scores.ai when Margarita saves — the training pair. */
export interface AiSnapshot {
  criteria: CriteriaScores;
  monthly: Record<string, { status: string }>;
  total: number;
}

interface CriterionStats {
  sum: number;
  count: number;
}

export interface AiModel {
  /** Margarita's average criterion scores per accountant (and overall). */
  criteria: Record<string, Partial<Record<CriterionId, CriterionStats>>>;
  global: Partial<Record<CriterionId, CriterionStats>>;
  /** Learned correction: mean(final − ai_total), per accountant + overall. */
  bias: Record<string, CriterionStats>;
  globalBias: CriterionStats;
  /** Number of (AI, Margarita) pairs the model has learned from. */
  trainedPairs: number;
}

const GLOBAL = "__global__";

function emptyModel(): AiModel {
  return {
    criteria: {},
    global: {},
    bias: {},
    globalBias: { sum: 0, count: 0 },
    trainedPairs: 0,
  };
}

function addStat(
  rec: Partial<Record<CriterionId, CriterionStats>>,
  id: CriterionId,
  value: number
) {
  const s = rec[id] ?? { sum: 0, count: 0 };
  s.sum += value;
  s.count += 1;
  rec[id] = s;
}

/**
 * Train the model from Margarita's saved evaluations (read from Supabase via
 * the repo). Pure + JSON-serializable, so the server can train and hand the
 * model to the client component.
 */
export function trainAiModel(evaluations: Evaluation[]): AiModel {
  const m = emptyModel();
  for (const ev of evaluations) {
    const acc = ev.accountant ?? GLOBAL;
    // Learn her criterion-scoring pattern.
    for (const c of CRITERIA) {
      const v = ev.scores.criteria?.[c.id];
      if (typeof v !== "number" || Number.isNaN(v)) continue;
      m.criteria[acc] ??= {};
      addStat(m.criteria[acc], c.id, v);
      addStat(m.global, c.id, v);
    }
    // Learn from AI-vs-Margarita pairs (gated rows are rule-driven, skip).
    const ai = (ev.scores as { ai?: AiSnapshot }).ai;
    if (ai && typeof ai.total === "number" && ev.total_score > 1 && ai.total > 1) {
      const delta = ev.total_score - ai.total;
      const b = m.bias[acc] ?? { sum: 0, count: 0 };
      b.sum += delta;
      b.count += 1;
      m.bias[acc] = b;
      m.globalBias.sum += delta;
      m.globalBias.count += 1;
      m.trainedPairs += 1;
    }
  }
  return m;
}

function predictedCriterion(
  model: AiModel,
  accountant: string | null,
  id: CriterionId,
  scaleMax: number
): number {
  const acc = model.criteria[accountant ?? GLOBAL]?.[id];
  const stats = acc && acc.count > 0 ? acc : model.global[id];
  if (!stats || stats.count === 0) return scaleMax; // no history → full marks
  const avg = stats.sum / stats.count;
  return Math.max(0, Math.min(scaleMax, Math.round(avg)));
}

function learnedBias(model: AiModel, accountant: string | null): number {
  const acc = model.bias[accountant ?? GLOBAL];
  const stats = acc && acc.count > 0 ? acc : model.globalBias;
  if (!stats || stats.count === 0) return 0;
  return stats.sum / stats.count;
}

/**
 * Predict the full evaluation row for a chat: mailing statuses carried forward
 * from the previous check, criteria from the learned per-accountant pattern,
 * total through the same rules engine + the learned correction.
 */
export function predictEvaluation(
  accountant: string | null,
  prevStatuses: Record<string, string>,
  model: AiModel
): AiPrediction {
  const monthly: Record<string, { status: string }> = {};
  for (const cat of MONTHLY_CATEGORIES) {
    monthly[cat.id] = { status: prevStatuses[cat.id] ?? "Предстоящая" };
  }

  const criteria: CriteriaScores = {};
  for (const c of CRITERIA) {
    criteria[c.id] = predictedCriterion(model, accountant, c.id, c.scaleMax);
  }

  const base = computeOverall(criteria, monthly);
  const gated = isMailingFail(monthly);
  // Apply the learned Margarita-correction only to non-gated scores: a gated
  // chat is 1 by rule, not by judgement.
  const total = gated
    ? base
    : Math.max(1, Math.min(100, Math.round((base + learnedBias(model, accountant)) * 100) / 100));

  const note = gated
    ? "рассылка не выполнена → оценка 1"
    : model.trainedPairs > 0
      ? `прогноз обучен на ${model.trainedPairs} ${pluralEval(model.trainedPairs)} Маргариты`
      : "прогноз по статусам прошлой проверки";

  return { criteria, monthly, total, band: bandFor(total), note };
}

function pluralEval(n: number): string {
  const mod = n % 100;
  if (mod % 10 === 1 && mod !== 11) return "оценке";
  return "оценках";
}

/** The snapshot to persist with Margarita's row so the model can learn. */
export function toSnapshot(p: AiPrediction): AiSnapshot {
  return { criteria: p.criteria, monthly: p.monthly, total: p.total };
}
