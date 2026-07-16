// ---------------------------------------------------------------------------
// Self-learning AI evaluator.
//
// The AI fills the SAME fields as Margarita (Точность, СЛА, статусы рассылок,
// Общая, Кач-во) by analysing the data already in Supabase: the chat's facts
// (status / debts / deadline) and Margarita's past evaluations. Every time she
// saves her own row, the AI's snapshot is stored alongside it (scores.ai), so
// the next training pass compares "what AI said" vs "what Margarita said" and
// corrects itself.
//
// What makes the prediction good (June 2026 rework — "ai doesn't work good
// enough"):
//
//   • criteria (Точн./СЛА): a RECENCY-weighted, SHRUNK estimate of HER scores.
//     Recent evaluations count more (45-day half-life), and an accountant's own
//     average is blended toward the global average with a pseudo-count prior, so
//     a bookkeeper with 2 chats doesn't swing to an extreme while one with 200
//     reflects her real pattern.
//   • monthly statuses: predicted from the SAME facts the human row auto-fills
//     from — the debt feed (mqa_chats.debt_status), the client's Inactive flag,
//     and the waiting default ("Предстоящая" until the message scan detects the
//     action) — then carried-forward statuses, then "Предстоящая". This is what fixed the biggest miss: the AI
//     used to mark everything "Предстоящая", so its mailing GATE (and therefore
//     its total) disagreed with Margarita on every chat with a real debt.
//   • total: the rules engine on the predicted criteria + monthly, plus a learned
//     per-accountant bias = recency-weighted mean(her total − AI total).
//
// Everything is a pure function of the evaluation list, so the model retrains
// from the source of truth on every page load — no separate training state.
// ---------------------------------------------------------------------------

import {
  CRITERIA,
  MONTHLY_CATEGORIES,
  bandFor,
  canonicalMonthlyStatus,
  computeOverall,
  daysBetween,
  isMailingFail,
  type CriteriaScores,
  type CriterionId,
  type QualityBand,
} from "./scoring";
import { autoMonthlyStatus } from "./chat-list";
import type { Evaluation } from "./types";

export interface AiPrediction {
  criteria: CriteriaScores;
  monthly: Record<string, { status: string }>;
  total: number;
  band: QualityBand;
  /**
   * Уверенность модели в этом прогнозе, 0..100 (%). Детерминирована: растёт с
   * объёмом истории по бухгалтеру и общему числу обученных пар, падает при
   * большой исторической ошибке (learned bias); правило «рассылка не выполнена»
   * даёт высокую уверенность (это жёсткое правило, а не суждение модели).
   */
  confidence: number;
  /** Short human explanation of where the numbers came from. */
  note: string;
}

/** Snapshot persisted in scores.ai when Margarita saves — the training pair. */
export interface AiSnapshot {
  criteria: CriteriaScores;
  monthly: Record<string, { status: string }>;
  total: number;
  /** Уверенность модели в этом прогнозе (0..100), привязана к этой версии. */
  confidence: number;
}

/** The chat facts the AI uses to auto-fill mailing statuses (same as the human row). */
export interface ChatFacts {
  status?: string | null;
  debts?: string | null;
  debtStatus?: string | null;
  date?: string | null;
}

/** Weighted accumulator: `sum` = Σ(weight·value), `count` = Σ(weight). */
interface CriterionStats {
  sum: number;
  count: number;
}

export interface AiModel {
  /** Margarita's recency-weighted criterion scores per accountant (and overall). */
  criteria: Record<string, Partial<Record<CriterionId, CriterionStats>>>;
  global: Partial<Record<CriterionId, CriterionStats>>;
  /** Learned correction: recency-weighted mean(final − ai_total), per accountant + overall. */
  bias: Record<string, CriterionStats>;
  globalBias: CriterionStats;
  /** Number of (AI, Margarita) pairs the model has learned from. */
  trainedPairs: number;
}

const GLOBAL = "__global__";

// How fast old evaluations fade: a 45-day-old row counts half as much as today's.
const HALF_LIFE_DAYS = 45;
// Pseudo-count prior for criteria shrinkage: blend an accountant's own average
// with the global one as if we'd seen PRIOR_STRENGTH global samples for them.
const PRIOR_STRENGTH = 2;

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
  value: number,
  weight: number
) {
  const s = rec[id] ?? { sum: 0, count: 0 };
  s.sum += value * weight;
  s.count += weight;
  rec[id] = s;
}

/** Recency weight for a row, relative to the newest row in the set (half-life decay). */
function recencyWeight(dateISO: string, refISO: string): number {
  const age = Math.max(0, daysBetween(dateISO, refISO));
  return Math.pow(0.5, age / HALF_LIFE_DAYS);
}

/**
 * Train the model from Margarita's saved evaluations (read from Supabase via
 * the repo). Pure + JSON-serializable, so the server can train and hand the
 * model to the client component. Recent rows count more than old ones.
 */
export function trainAiModel(evaluations: Evaluation[]): AiModel {
  const m = emptyModel();
  if (evaluations.length === 0) return m;
  // Reference "now" = the newest evaluation date, so weights are stable
  // regardless of when the page is loaded (and tests are deterministic).
  const refDate = evaluations.reduce(
    (max, e) => (e.checking_date > max ? e.checking_date : max),
    evaluations[0].checking_date
  );

  for (const ev of evaluations) {
    const acc = ev.accountant ?? GLOBAL;
    const w = recencyWeight(ev.checking_date, refDate);
    // Learn her criterion-scoring pattern (recency-weighted).
    for (const c of CRITERIA) {
      const v = ev.scores.criteria?.[c.id];
      if (typeof v !== "number" || Number.isNaN(v)) continue;
      m.criteria[acc] ??= {};
      addStat(m.criteria[acc], c.id, v, w);
      addStat(m.global, c.id, v, w);
    }
    // Learn from AI-vs-Margarita pairs (gated rows are rule-driven, skip).
    const ai = (ev.scores as { ai?: AiSnapshot }).ai;
    if (ai && typeof ai.total === "number" && ev.total_score > 1 && ai.total > 1) {
      const delta = ev.total_score - ai.total;
      const b = m.bias[acc] ?? { sum: 0, count: 0 };
      b.sum += delta * w;
      b.count += w;
      m.bias[acc] = b;
      m.globalBias.sum += delta * w;
      m.globalBias.count += w;
      m.trainedPairs += 1;
    }
  }
  return m;
}

/** Global average for a criterion, or full marks when there's no history at all. */
function globalAverage(model: AiModel, id: CriterionId, scaleMax: number): number {
  const g = model.global[id];
  return g && g.count > 0 ? g.sum / g.count : scaleMax;
}

/**
 * Predicted criterion = the accountant's own (recency-weighted) average, shrunk
 * toward the global average by a pseudo-count prior. Low-data accountants lean
 * global; high-data ones reflect their real pattern. Rounded to the 0..scaleMax
 * grid at the end.
 */
function predictedCriterion(
  model: AiModel,
  accountant: string | null,
  id: CriterionId,
  scaleMax: number
): number {
  const prior = globalAverage(model, id, scaleMax);
  const acc = model.criteria[accountant ?? GLOBAL]?.[id];
  const accSum = acc?.sum ?? 0;
  const accW = acc?.count ?? 0;
  const blended = (accSum + PRIOR_STRENGTH * prior) / (accW + PRIOR_STRENGTH);
  return Math.max(0, Math.min(scaleMax, Math.round(blended)));
}

function learnedBias(model: AiModel, accountant: string | null): number {
  const acc = model.bias[accountant ?? GLOBAL];
  const stats = acc && acc.count > 0 ? acc : model.globalBias;
  if (!stats || stats.count === 0) return 0;
  return stats.sum / stats.count;
}

// Confidence tuning constants (documented so the analytics читаются осмысленно).
const CONFIDENCE_GATED = 95; // жёсткое правило «рассылка не выполнена» → высокая уверенность
const CONFIDENCE_BASE = 45; // старт при полном отсутствии истории
const CONFIDENCE_ACC_MAX = 40; // максимальная прибавка за историю по бухгалтеру
const CONFIDENCE_GLOBAL_MAX = 12; // максимальная прибавка за общий объём обучения
const CONFIDENCE_ACC_SCALE = 6; // «половинное насыщение» по эффективному числу оценок бухгалтера
const CONFIDENCE_GLOBAL_SCALE = 30; // то же по общему числу обученных пар
const CONFIDENCE_BIAS_PENALTY_MAX = 25; // штраф за большую историческую ошибку модели
const CONFIDENCE_CEIL = 99; // модель никогда не заявляет 100% — оставляем «зазор»

/** Эффективное число оценок бухгалтера (recency-weighted) по критериям. */
function accountantEffectiveN(model: AiModel, accountant: string | null): number {
  const rec = model.criteria[accountant ?? GLOBAL];
  if (!rec) return 0;
  let best = 0;
  for (const c of CRITERIA) {
    const s = rec[c.id];
    if (s && s.count > best) best = s.count;
  }
  return best;
}

/**
 * Детерминированная уверенность модели (0..100) для одного прогноза. Чистая
 * функция от обученной модели, бухгалтера и признака «gated» — одинаковый вход
 * даёт одинаковый выход (важно для тестов и для привязки уверенности к версии).
 */
export function predictionConfidence(
  model: AiModel,
  accountant: string | null,
  gated: boolean
): number {
  if (gated) return CONFIDENCE_GATED;
  const nAcc = accountantEffectiveN(model, accountant);
  const nGlob = model.trainedPairs;
  const bias = Math.abs(learnedBias(model, accountant));
  let conf = CONFIDENCE_BASE;
  conf += CONFIDENCE_ACC_MAX * (1 - Math.exp(-nAcc / CONFIDENCE_ACC_SCALE));
  conf += CONFIDENCE_GLOBAL_MAX * (1 - Math.exp(-nGlob / CONFIDENCE_GLOBAL_SCALE));
  conf -= Math.min(CONFIDENCE_BIAS_PENALTY_MAX, bias);
  return Math.max(0, Math.min(CONFIDENCE_CEIL, Math.round(conf)));
}

/**
 * The AI's mailing status for one category, from the same facts the human row
 * auto-fills from: the debt feed wins for «Долги»; otherwise a carried-forward
 * status, then the fact-based auto-fill (Inactive / deadline → «Предстоящая»),
 * then «Предстоящая». Without facts (legacy callers) it just carries forward.
 */
function predictedMonthlyStatus(
  cat: (typeof MONTHLY_CATEGORIES)[number],
  prevStatuses: Record<string, string>,
  facts?: ChatFacts
): string {
  const prevVal = canonicalMonthlyStatus(cat, prevStatuses[cat.id]);
  if (cat.id === "debts" && facts) {
    return (
      canonicalMonthlyStatus(cat, facts.debtStatus) ||
      prevVal ||
      autoMonthlyStatus(cat, facts.status, facts.debts, facts.date ?? "") ||
      "Предстоящая"
    );
  }
  if (facts) {
    return (
      prevVal ||
      autoMonthlyStatus(cat, facts.status, facts.debts, facts.date ?? "") ||
      "Предстоящая"
    );
  }
  // Legacy path (no facts): carry forward, else "Предстоящая".
  return prevStatuses[cat.id] ?? "Предстоящая";
}

/**
 * Predict the full evaluation row for a chat: mailing statuses from the chat
 * facts (+ carried-forward), criteria from the learned per-accountant pattern,
 * total through the same rules engine + the learned correction.
 */
export function predictEvaluation(
  accountant: string | null,
  prevStatuses: Record<string, string>,
  model: AiModel,
  facts?: ChatFacts
): AiPrediction {
  const monthly: Record<string, { status: string }> = {};
  for (const cat of MONTHLY_CATEGORIES) {
    monthly[cat.id] = { status: predictedMonthlyStatus(cat, prevStatuses, facts) };
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

  const confidence = predictionConfidence(model, accountant, gated);

  return { criteria, monthly, total, band: bandFor(total), confidence, note };
}

function pluralEval(n: number): string {
  const mod = n % 100;
  if (mod % 10 === 1 && mod !== 11) return "оценке";
  return "оценках";
}

/** The snapshot to persist with Margarita's row so the model can learn. */
export function toSnapshot(p: AiPrediction): AiSnapshot {
  return {
    criteria: p.criteria,
    monthly: p.monthly,
    total: p.total,
    confidence: p.confidence,
  };
}
