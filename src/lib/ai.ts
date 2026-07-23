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
import { buildCalibration, calibrateConfidence, type Calibration } from "./confidence-calibration";
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
  /** Raw evidence-based confidence BEFORE historical calibration (for debugging). */
  rawConfidence: number;
  /** True when calibration was preliminary (thin history) — value == raw. */
  calibrationPreliminary: boolean;
  /** Short human explanation of where the numbers came from. */
  note: string;
  /**
   * Concise, evidence-based uncertainty indicators (RU) for THIS prediction —
   * never private chain-of-thought, only what limits certainty («мало истории»,
   * «не хватает данных по статусам рассылок», …). Empty when nothing stands out.
   */
  uncertainty: string[];
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

/**
 * Weighted accumulator: `sum` = Σ(weight·value), `count` = Σ(weight),
 * `sumSq` = Σ(weight·value²) so we can recover the weighted variance (spread) of
 * an accountant's scores — high spread ⇒ a point prediction is less certain.
 */
interface CriterionStats {
  sum: number;
  count: number;
  sumSq: number;
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
  /**
   * Historical calibration table (confidence bucket → observed accuracy from
   * Margarita's corrections). Built from the SAME evaluation list; used to map
   * the raw evidence confidence to the historically-observed value. Null when
   * there's no reviewed history yet.
   */
  calibration: Calibration | null;
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
    globalBias: { sum: 0, count: 0, sumSq: 0 },
    trainedPairs: 0,
    calibration: null,
  };
}

function addStat(
  rec: Partial<Record<CriterionId, CriterionStats>>,
  id: CriterionId,
  value: number,
  weight: number
) {
  const s = rec[id] ?? { sum: 0, count: 0, sumSq: 0 };
  s.sum += value * weight;
  s.count += weight;
  s.sumSq += value * value * weight;
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
      const b = m.bias[acc] ?? { sum: 0, count: 0, sumSq: 0 };
      b.sum += delta * w;
      b.count += w;
      b.sumSq += delta * delta * w;
      m.bias[acc] = b;
      m.globalBias.sum += delta * w;
      m.globalBias.count += w;
      m.globalBias.sumSq += delta * delta * w;
      m.trainedPairs += 1;
    }
  }
  // Feedback loop: learn how often each confidence bucket was actually corrected
  // by Margarita, so predictionConfidence can map raw → observed accuracy. All
  // rows are in the past relative to any NEW prediction ⇒ no data leakage.
  m.calibration = buildCalibration(evaluations);
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

// ---------------------------------------------------------------------------
// Confidence: honest, EVIDENCE-based (not volume-based).
//
// The old formula was `45 + up to 52 for the amount of history − bias`, so any
// accountant with a normal history saturated at ~90–97 % and a gated row was a
// flat 95 %. That measured "how much data we have", NOT "how certain THIS
// evaluation is", which is exactly why almost every value sat in the 90–96 band.
//
// The new score is built from the evidence actually available for the specific
// prediction and starts LOW, so >90 % is earned, not the default:
//   • is the accountant identified at all (else the model can't personalise);
//   • how much REAL per-accountant history backs the criteria (saturating);
//   • how CONSISTENT her past scores are (high spread ⇒ a point guess is shaky),
//     trusted only in proportion to how much data we have;
//   • how COMPLETE the chat facts are that drive the mailing statuses/gate;
//   • a penalty for large historical model error (learned bias);
//   • a gated hard-rule row is genuinely high-confidence (direct evidence), but
//     scaled by fact completeness, not a flat constant.
// The value is then run through the historical CALIBRATION layer.
// ---------------------------------------------------------------------------

const CONF_CEIL = 95; // модель никогда не заявляет >95% — всегда оставляем «зазор»
const CONF_PRIOR = 20; // старт: без данных мы почти ничего не знаем
const CONF_ACC_MAX = 40; // максимум за реальную историю по бухгалтеру
const CONF_ACC_SCALE = 8; // «половинное насыщение» по эффективному числу оценок
const CONF_CONSISTENCY_MAX = 25; // максимум за согласованность её оценок (низкий разброс)
const CONF_CONSISTENCY_DATA_SCALE = 4; // разбросу верим лишь при достаточной истории
const CONF_FACTS_MAX = 15; // максимум за полноту фактов (статусы рассылок)
const CONF_BIAS_PENALTY_MAX = 22; // штраф за большую историческую ошибку модели

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

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
 * Нормированный разброс (0..1) оценок бухгалтера по критериям: средневзвешенное
 * стандартное отклонение, делённое на шкалу критерия. 0 — оценки всегда
 * одинаковы (уверенно), ближе к 1 — сильно «прыгают» (неуверенно).
 */
function accountantDispersion(model: AiModel, accountant: string | null): number {
  const rec = model.criteria[accountant ?? GLOBAL];
  if (!rec) return 1; // нет данных — считаем максимально неопределённым
  const ratios: number[] = [];
  for (const c of CRITERIA) {
    const s = rec[c.id];
    if (!s || s.count <= 0) continue;
    const mean = s.sum / s.count;
    const variance = Math.max(0, s.sumSq / s.count - mean * mean);
    const std = Math.sqrt(variance);
    ratios.push(clamp01(std / (c.scaleMax || 5)));
  }
  if (ratios.length === 0) return 1;
  return ratios.reduce((a, b) => a + b, 0) / ratios.length;
}

export interface ConfidenceFactors {
  accountantIdentified: boolean;
  effectiveHistory: number;
  dispersion: number;
  biasMagnitude: number;
  gated: boolean;
  /** 0..1 completeness of the facts that drive the mailing statuses/gate. */
  factCompleteness: number;
}

/**
 * Детерминированная СЫРАЯ уверенность (0..100) до калибровки. Чистая функция от
 * факторов доказательности — одинаковый вход даёт одинаковый выход.
 */
export function predictionConfidenceRaw(f: ConfidenceFactors): number {
  const bias = Math.min(CONF_BIAS_PENALTY_MAX, Math.abs(f.biasMagnitude));

  if (f.gated) {
    // Жёсткое правило «рассылка не выполнена» — прямое доказательство, поэтому
    // уверенность высокая, НО масштабируется полнотой фактов, а не константой.
    const base = 78 + CONF_FACTS_MAX * f.factCompleteness - bias * 0.5;
    return Math.max(0, Math.min(CONF_CEIL, Math.round(base)));
  }

  let conf = CONF_PRIOR;
  if (f.accountantIdentified) {
    const dataTrust = 1 - Math.exp(-f.effectiveHistory / CONF_ACC_SCALE);
    conf += CONF_ACC_MAX * dataTrust;
    // Согласованности верим только в меру накопленной истории.
    const consistency = CONF_CONSISTENCY_MAX * (1 - clamp01(f.dispersion));
    conf += consistency * (1 - Math.exp(-f.effectiveHistory / CONF_CONSISTENCY_DATA_SCALE));
  }
  conf += CONF_FACTS_MAX * clamp01(f.factCompleteness);
  conf -= bias;
  return Math.max(0, Math.min(CONF_CEIL, Math.round(conf)));
}

/**
 * Полная уверенность прогноза: сырая доказательная оценка, пропущенная через
 * историческую калибровку (наблюдаемая точность по бакету). Возвращает и сырое,
 * и калиброванное значение + флаг «калибровка предварительна».
 */
export function predictionConfidence(
  model: AiModel,
  accountant: string | null,
  gated: boolean,
  factCompleteness: number
): { value: number; raw: number; preliminary: boolean } {
  const factors: ConfidenceFactors = {
    accountantIdentified: Boolean(accountant),
    effectiveHistory: accountantEffectiveN(model, accountant),
    dispersion: accountantDispersion(model, accountant),
    biasMagnitude: learnedBias(model, accountant),
    gated,
    factCompleteness,
  };
  const raw = predictionConfidenceRaw(factors);
  const cal = calibrateConfidence(raw, model.calibration);
  // Keep the «никогда не >95%» invariant AFTER calibration too: a bucket that
  // historically ran at 100% accuracy must not push the shown confidence past
  // the ceiling (calibrateConfidence clamps to 0..100; we re-apply CONF_CEIL).
  const value = Math.min(CONF_CEIL, cal.value ?? raw);
  return { value, raw, preliminary: cal.preliminary };
}

/** Concise, evidence-based uncertainty indicators (RU) — never chain-of-thought. */
function uncertaintyNotes(
  model: AiModel,
  accountant: string | null,
  gated: boolean,
  factCompleteness: number
): string[] {
  const out: string[] = [];
  if (gated) out.push("Рассылка не выполнена — применено жёсткое правило (оценка 1)");
  if (!accountant) out.push("Бухгалтер не определён — прогноз обобщённый");
  else {
    const effN = accountantEffectiveN(model, accountant);
    if (effN < 3) out.push("Мало истории по этому бухгалтеру — прогноз опирается на общий шаблон");
    else if (accountantDispersion(model, accountant) > 0.3)
      out.push("Оценки бухгалтера заметно варьируются — точный балл менее предсказуем");
  }
  if (!gated && factCompleteness < 0.5)
    out.push("Не хватает данных по статусам рассылок");
  if (Math.abs(learnedBias(model, accountant)) > 5)
    out.push("Модель исторически расходится с итогом Маргариты по этому бухгалтеру");
  return out;
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

  const factCompleteness = factCompletenessOf(prevStatuses, facts);
  const conf = predictionConfidence(model, accountant, gated, factCompleteness);
  const uncertainty = uncertaintyNotes(model, accountant, gated, factCompleteness);
  if (conf.preliminary && model.calibration && model.calibration.totalReviewed > 0) {
    uncertainty.push("Калибровка предварительная — мало проверенных оценок в этом диапазоне");
  }

  return {
    criteria,
    monthly,
    total,
    band: bandFor(total),
    confidence: conf.value,
    rawConfidence: conf.raw,
    calibrationPreliminary: conf.preliminary,
    note,
    uncertainty,
  };
}

/**
 * How complete are the facts backing this prediction (0..1)? Facts drive the
 * mailing statuses and therefore the gate/total, so their completeness is a
 * direct evidence signal. Combines: any facts at all, a real debt status, and
 * how many monthly categories carry a known previous status.
 */
function factCompletenessOf(
  prevStatuses: Record<string, string>,
  facts?: ChatFacts
): number {
  let fc = 0;
  if (facts) fc += 0.4;
  if (facts?.debtStatus && facts.debtStatus.trim()) fc += 0.3;
  const knownPrev =
    MONTHLY_CATEGORIES.filter((c) => (prevStatuses[c.id] ?? "").trim()).length /
    Math.max(1, MONTHLY_CATEGORIES.length);
  fc += 0.3 * knownPrev;
  return Math.max(0, Math.min(1, fc));
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
