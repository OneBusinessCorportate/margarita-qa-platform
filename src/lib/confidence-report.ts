// ---------------------------------------------------------------------------
// Аналитический отчёт «Уверенность модели ↔ исправления Маргариты».
//
// Чистая функция от списка оценок (Evaluation[]) и фильтров — без доступа к БД,
// как buildReport в report.ts. Считает:
//   • сколько всего AI-оценок, сколько принято / исправлено / не проверено;
//   • разбивку по диапазонам уверенности с процентом исправлений
//     (corrected / reviewed × 100, непроверенные НЕ в знаменателе);
//   • среднюю уверенность принятых и исправленных;
//   • метрики порога ≥90% (доля, правки, «Точность оценок с уверенностью 90%+»);
//   • корреляцию Пирсона (уверенность ↔ факт исправления) только по проверенным
//     оценкам с валидной уверенностью + предупреждение о нехватке данных.
//
// Строки без валидной уверенности («Нет данных») учитываются в общем количестве,
// но ИСКЛЮЧАЮТСЯ из всех расчётов на основе уверенности (не считаются 0%).
// ---------------------------------------------------------------------------

import type { Evaluation, ReviewStatus } from "./types";
import {
  CONFIDENCE_RANGES,
  HIGH_CONFIDENCE_THRESHOLD,
  INSUFFICIENT_DATA_MESSAGE,
  MIN_REVIEWED_FOR_CORRELATION,
  evaluationConfidence,
  interpretCorrelation,
  isReviewed,
  pearson,
  rangeOf,
} from "./confidence";

export interface ConfidenceReportFilters {
  from?: string; // ISO YYYY-MM-DD (по дате проверки), включительно
  to?: string;
  accountant?: string;
  /** Категория оценки = id схемы (accounting / accounting_kpi / …). */
  category?: string;
  /** id диапазона уверенности (см. CONFIDENCE_RANGES) либо undefined = все. */
  confidenceRange?: string;
  /** Статус проверки либо undefined = все. */
  status?: ReviewStatus;
}

export interface ConfidenceRangeRow {
  id: string;
  label: string;
  total: number;
  accepted: number;
  corrected: number;
  notReviewed: number;
  reviewed: number;
  /** corrected / reviewed × 100; null, если проверенных в диапазоне нет. */
  correctionPct: number | null;
}

export interface ConfidenceHighMetrics {
  count: number; // оценок с уверенностью ≥90%
  pct: number | null; // % от оценок с валидной уверенностью
  reviewed: number;
  accepted: number;
  corrected: number;
  correctedPct: number | null; // corrected / reviewed × 100
  /** «Точность оценок с уверенностью 90%+» = accepted / reviewed × 100. */
  accuracyPct: number | null;
}

export interface ConfidenceCorrelation {
  r: number | null;
  n: number; // число проверенных оценок с валидной уверенностью
  interpretation: string;
  insufficient: boolean;
  /** INSUFFICIENT_DATA_MESSAGE, когда n < порога, иначе null. */
  warning: string | null;
}

export interface ConfidenceReport {
  total: number; // всего AI-оценок в выборке
  withConfidence: number; // из них с валидной уверенностью
  noConfidence: number; // «Нет данных»
  accepted: number;
  corrected: number;
  notReviewed: number;
  reviewed: number;
  acceptedPct: number; // % от total
  correctedPct: number; // % от total
  notReviewedPct: number; // % от total
  /** corrected / reviewed × 100; null, если проверенных нет. */
  overallCorrectionPct: number | null;
  avgConfidenceAccepted: number | null;
  avgConfidenceCorrected: number | null;
  ranges: ConfidenceRangeRow[];
  high: ConfidenceHighMetrics;
  correlation: ConfidenceCorrelation;
  filters: ConfidenceReportFilters;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function pct(part: number, whole: number): number {
  return whole > 0 ? round1((part / whole) * 100) : 0;
}

/** Процент исправлений: corrected / reviewed × 100 (null, если нет проверенных). */
function correctionPct(corrected: number, reviewed: number): number | null {
  return reviewed > 0 ? round1((corrected / reviewed) * 100) : null;
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return round1(nums.reduce((s, n) => s + n, 0) / nums.length);
}

/** Оценка попадает в область фичи (AI-оценка бухгалтера). */
function inScope(e: Evaluation): boolean {
  return (e.role ?? "accountant") === "accountant";
}

function statusOf(e: Evaluation): ReviewStatus {
  return e.review_status ?? "not_reviewed";
}

function passesFilters(e: Evaluation, f: ConfidenceReportFilters): boolean {
  const d = e.checking_date.slice(0, 10);
  if (f.from && d < f.from) return false;
  if (f.to && d > f.to) return false;
  if (f.accountant && e.accountant !== f.accountant) return false;
  if (f.category && (e.scores?.scheme ?? "accounting") !== f.category) return false;
  if (f.status && statusOf(e) !== f.status) return false;
  if (f.confidenceRange) {
    const r = rangeOf(evaluationConfidence(e));
    if (!r || r.id !== f.confidenceRange) return false;
  }
  return true;
}

/**
 * Считает отчёт по уверенности. `evaluations` — сырой список (обычно уже
 * ограниченный периодом/бухгалтером на уровне запроса); все фильтры применяются
 * здесь ещё раз, чтобы функция была самодостаточной и тестируемой.
 */
export function buildConfidenceReport(
  evaluations: Evaluation[],
  filters: ConfidenceReportFilters = {}
): ConfidenceReport {
  const rows = evaluations.filter((e) => inScope(e) && passesFilters(e, filters));

  let accepted = 0;
  let corrected = 0;
  let notReviewed = 0;
  let withConfidence = 0;
  const acceptedConf: number[] = [];
  const correctedConf: number[] = [];
  const correlationPairs: Array<[number, number]> = [];

  // Диапазоны: заранее создаём строки, чтобы порядок и полнота были стабильны.
  const rangeAcc = new Map<string, ConfidenceRangeRow>();
  for (const r of CONFIDENCE_RANGES) {
    rangeAcc.set(r.id, {
      id: r.id,
      label: r.label,
      total: 0,
      accepted: 0,
      corrected: 0,
      notReviewed: 0,
      reviewed: 0,
      correctionPct: null,
    });
  }

  const high = {
    count: 0,
    reviewed: 0,
    accepted: 0,
    corrected: 0,
  };

  for (const e of rows) {
    const status = statusOf(e);
    if (status === "accepted") accepted++;
    else if (status === "corrected") corrected++;
    else notReviewed++;

    const conf = evaluationConfidence(e);
    if (conf == null) continue; // «Нет данных» — вне расчётов по уверенности
    withConfidence++;

    const reviewed = isReviewed(status);
    if (status === "accepted") acceptedConf.push(conf);
    if (status === "corrected") correctedConf.push(conf);
    if (reviewed) correlationPairs.push([conf, status === "corrected" ? 1 : 0]);

    const range = rangeAcc.get(rangeOf(conf)!.id)!;
    range.total++;
    if (status === "accepted") range.accepted++;
    else if (status === "corrected") range.corrected++;
    else range.notReviewed++;
    if (reviewed) range.reviewed++;

    if (conf >= HIGH_CONFIDENCE_THRESHOLD) {
      high.count++;
      if (status === "accepted") high.accepted++;
      else if (status === "corrected") high.corrected++;
      if (reviewed) high.reviewed++;
    }
  }

  const ranges = CONFIDENCE_RANGES.map((r) => {
    const row = rangeAcc.get(r.id)!;
    row.correctionPct = correctionPct(row.corrected, row.reviewed);
    return row;
  });

  const total = rows.length;
  const reviewed = accepted + corrected;
  const noConfidence = total - withConfidence;

  const r = pearson(correlationPairs);
  const n = correlationPairs.length;
  const interp = interpretCorrelation(r, n);

  return {
    total,
    withConfidence,
    noConfidence,
    accepted,
    corrected,
    notReviewed,
    reviewed,
    acceptedPct: pct(accepted, total),
    correctedPct: pct(corrected, total),
    notReviewedPct: pct(notReviewed, total),
    overallCorrectionPct: correctionPct(corrected, reviewed),
    avgConfidenceAccepted: avg(acceptedConf),
    avgConfidenceCorrected: avg(correctedConf),
    ranges,
    high: {
      count: high.count,
      pct: withConfidence > 0 ? pct(high.count, withConfidence) : null,
      reviewed: high.reviewed,
      accepted: high.accepted,
      corrected: high.corrected,
      correctedPct: correctionPct(high.corrected, high.reviewed),
      accuracyPct:
        high.reviewed > 0 ? round1((high.accepted / high.reviewed) * 100) : null,
    },
    correlation: {
      r: r == null ? null : Math.round(r * 1000) / 1000,
      n,
      interpretation: interp.text,
      insufficient: interp.insufficient,
      warning: n < MIN_REVIEWED_FOR_CORRELATION ? INSUFFICIENT_DATA_MESSAGE : null,
    },
    filters,
  };
}
