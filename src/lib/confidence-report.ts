// ---------------------------------------------------------------------------
// Аналитический отчёт «Уверенность модели ↔ исправления Маргариты».
//
// Чистая функция от списка оценок (Evaluation[]) и фильтров — без доступа к БД,
// как buildReport в report.ts. Отвечает на вопрос:
//   «Сколько оценок чатов исправлено Маргаритой и какая корреляция с
//    уверенностью модели в данных?»
//
// Считает:
//   • сколько всего AI-оценок, сколько принято / исправлено / не проверено;
//   • совпадения exact / partial / mismatch (см. src/lib/match.ts) + средняя и
//     медианная разница баллов;
//   • разбивку по диапазонам уверенности (кол-во, совпадения, % исправлений,
//     средняя разница баллов);
//   • среднюю уверенность принятых/исправленных и совпавших/несовпавших;
//   • метрики порога ≥90% (доля, правки, точность);
//   • две корреляции Пирсона: (1) уверенность ↔ факт исправления (point-biserial,
//     0/1), (2) уверенность ↔ модуль разницы баллов;
//   • статистику по каждому бухгалтеру;
//   • детальную таблицу исправленных оценок.
//
// Строки без валидной уверенности («Нет данных») учитываются в total, но
// ИСКЛЮЧАЮТСЯ из расчётов на основе уверенности (не 0%). Проверенные строки без
// исходного AI-снимка ИСКЛЮЧАЮТСЯ из статистики совпадений (не угадываем).
// ---------------------------------------------------------------------------

import type { Evaluation, ReviewStatus } from "./types";
import {
  CONFIDENCE_RANGES,
  HIGH_CONFIDENCE_THRESHOLD,
  INSUFFICIENT_DATA_MESSAGE,
  MIN_REVIEWED_FOR_CORRELATION,
  evaluationAiTotal,
  evaluationConfidence,
  interpretCorrelation,
  isReviewed,
  pearson,
  rangeOf,
} from "./confidence";
import { classifyMatch, median, type MatchStatus } from "./match";
import { bandFor, type QualityBand } from "./scoring";

export interface ConfidenceReportFilters {
  from?: string; // ISO YYYY-MM-DD (по дате проверки), включительно
  to?: string;
  accountant?: string;
  /** Chat / client agr_no. */
  chat?: string;
  /** Категория оценки = id схемы (accounting / accounting_kpi / …). */
  category?: string;
  /** id диапазона уверенности (см. CONFIDENCE_RANGES) либо undefined = все. */
  confidenceRange?: string;
  /** Статус проверки либо undefined = все. */
  status?: ReviewStatus;
  /** Статус совпадения (exact / partial / mismatch) либо undefined = все. */
  matchStatus?: MatchStatus;
}

export interface ConfidenceRangeRow {
  id: string;
  label: string;
  total: number;
  accepted: number;
  corrected: number;
  notReviewed: number;
  reviewed: number;
  /** exact / partial / mismatch по строкам с исходным AI-снимком. */
  exact: number;
  partial: number;
  mismatch: number;
  /** corrected / reviewed × 100; null, если проверенных в диапазоне нет. */
  correctionPct: number | null;
  /** Средний модуль разницы баллов по проверенным строкам с AI-снимком. */
  avgScoreDiff: number | null;
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

export interface MatchMetrics {
  /** Проверенные строки с исходным AI-снимком (exact+partial+mismatch). */
  comparable: number;
  exact: number;
  partial: number;
  mismatch: number;
  matched: number; // exact + partial
  /** Проверенные строки без AI-снимка — исключены из статистики совпадений. */
  excludedNoBaseline: number;
  exactPct: number | null; // exact / comparable
  acceptablePct: number | null; // matched / comparable
  mismatchPct: number | null; // mismatch / comparable
  avgScoreDiff: number | null; // средняя ЗНАКОВАЯ разница (final − ai)
  avgAbsScoreDiff: number | null; // средний модуль разницы
  medianScoreDiff: number | null; // медиана знаковой разницы
  avgConfidenceMatched: number | null;
  avgConfidenceMismatched: number | null;
}

export interface AccountantConfidenceRow {
  accountant: string;
  reviewed: number;
  accepted: number; // без изменений
  corrected: number;
  correctionPct: number | null;
  avgConfidence: number | null;
  avgAbsScoreDiff: number | null;
  /** Оценки с уверенностью ≥90%, исправленные Маргаритой. */
  high90Corrected: number;
}

export interface CorrectedDetailRow {
  id: string;
  date: string;
  accountant: string | null;
  chat: string;
  aiScore: number | null;
  finalScore: number;
  scoreDiff: number | null;
  aiBand: QualityBand | null;
  finalBand: QualityBand;
  confidence: number | null;
  matchStatus: MatchStatus | null;
  changedFields: string[];
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
  avgConfidence: number | null; // средняя уверенность по всем строкам с данными
  avgConfidenceAccepted: number | null;
  avgConfidenceCorrected: number | null;
  ranges: ConfidenceRangeRow[];
  high: ConfidenceHighMetrics;
  matches: MatchMetrics;
  /** Корреляция уверенность ↔ факт исправления (0/1, point-biserial). */
  correlation: ConfidenceCorrelation;
  /** Корреляция уверенность ↔ модуль разницы баллов. */
  correlationScoreDiff: ConfidenceCorrelation;
  byAccountant: AccountantConfidenceRow[];
  detailed: CorrectedDetailRow[];
  filters: ConfidenceReportFilters;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function pct(part: number, whole: number): number {
  return whole > 0 ? round1((part / whole) * 100) : 0;
}

function correctionPct(corrected: number, reviewed: number): number | null {
  return reviewed > 0 ? round1((corrected / reviewed) * 100) : null;
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return round1(nums.reduce((s, n) => s + n, 0) / nums.length);
}

function inScope(e: Evaluation): boolean {
  return (e.role ?? "accountant") === "accountant";
}

function statusOf(e: Evaluation): ReviewStatus {
  return e.review_status ?? "not_reviewed";
}

/** Match info for an evaluation, or null when there's no AI baseline. */
function matchOf(e: Evaluation) {
  return classifyMatch(e.scores?.ai, e.scores, e.total_score);
}

function passesFilters(e: Evaluation, f: ConfidenceReportFilters): boolean {
  const d = e.checking_date.slice(0, 10);
  if (f.from && d < f.from) return false;
  if (f.to && d > f.to) return false;
  if (f.accountant && e.accountant !== f.accountant) return false;
  if (f.chat && e.chat_agr_no !== f.chat) return false;
  if (f.category && (e.scores?.scheme ?? "accounting") !== f.category) return false;
  if (f.status && statusOf(e) !== f.status) return false;
  if (f.confidenceRange) {
    const r = rangeOf(evaluationConfidence(e));
    if (!r || r.id !== f.confidenceRange) return false;
  }
  if (f.matchStatus) {
    const m = matchOf(e);
    if (!m || m.status !== f.matchStatus) return false;
  }
  return true;
}

/**
 * Считает отчёт по уверенности. `evaluations` — сырой список; фильтры
 * применяются здесь, чтобы функция была самодостаточной и тестируемой.
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
  const allConf: number[] = [];
  const acceptedConf: number[] = [];
  const correctedConf: number[] = [];
  const matchedConf: number[] = [];
  const mismatchedConf: number[] = [];
  const correlationPairs: Array<[number, number]> = [];
  const correlationDiffPairs: Array<[number, number]> = [];

  // Match aggregation (rows with an AI baseline only).
  let mExact = 0;
  let mPartial = 0;
  let mMismatch = 0;
  let excludedNoBaseline = 0;
  const signedDiffs: number[] = [];
  const absDiffs: number[] = [];

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
      exact: 0,
      partial: 0,
      mismatch: 0,
      correctionPct: null,
      avgScoreDiff: null,
    });
  }
  const rangeAbsDiffs = new Map<string, number[]>(CONFIDENCE_RANGES.map((r) => [r.id, []]));

  const high = { count: 0, reviewed: 0, accepted: 0, corrected: 0 };

  // Per-accountant accumulation.
  interface AccAcc {
    reviewed: number;
    accepted: number;
    corrected: number;
    conf: number[];
    absDiff: number[];
    high90Corrected: number;
  }
  const accMap = new Map<string, AccAcc>();
  const accOf = (name: string): AccAcc => {
    let a = accMap.get(name);
    if (!a) {
      a = { reviewed: 0, accepted: 0, corrected: 0, conf: [], absDiff: [], high90Corrected: 0 };
      accMap.set(name, a);
    }
    return a;
  };

  const detailed: CorrectedDetailRow[] = [];

  for (const e of rows) {
    const status = statusOf(e);
    if (status === "accepted") accepted++;
    else if (status === "corrected") corrected++;
    else notReviewed++;

    const conf = evaluationConfidence(e);
    const reviewed = isReviewed(status);
    const match = matchOf(e);

    // Match statistics (only rows with an AI baseline; independent of conf).
    if (reviewed) {
      if (match) {
        if (match.status === "exact") mExact++;
        else if (match.status === "partial") mPartial++;
        else mMismatch++;
        signedDiffs.push(match.scoreDiff);
        absDiffs.push(match.absScoreDiff);
      } else {
        excludedNoBaseline++;
      }
    }

    // Per-accountant.
    if (reviewed) {
      const a = accOf(e.accountant ?? "—");
      a.reviewed++;
      if (status === "accepted") a.accepted++;
      else a.corrected++;
      if (conf != null) a.conf.push(conf);
      if (match) a.absDiff.push(match.absScoreDiff);
      if (conf != null && conf >= HIGH_CONFIDENCE_THRESHOLD && status === "corrected") a.high90Corrected++;
    }

    // Detailed table: corrected rows (or partial/mismatch) with a baseline.
    if (reviewed && match && (status === "corrected" || match.status !== "exact")) {
      const aiScore = evaluationAiTotal(e);
      detailed.push({
        id: e.id,
        date: e.checking_date.slice(0, 10),
        accountant: e.accountant,
        chat: e.chat_agr_no,
        aiScore,
        finalScore: e.total_score,
        scoreDiff: match.scoreDiff,
        aiBand: aiScore != null ? bandFor(aiScore) : null,
        finalBand: e.quality_band,
        confidence: conf,
        matchStatus: match.status,
        changedFields: match.changedFields,
      });
    }

    if (conf == null) continue; // «Нет данных» — вне расчётов по уверенности
    withConfidence++;
    allConf.push(conf);

    if (status === "accepted") acceptedConf.push(conf);
    if (status === "corrected") correctedConf.push(conf);
    if (reviewed) {
      correlationPairs.push([conf, status === "corrected" ? 1 : 0]);
      if (match) {
        correlationDiffPairs.push([conf, match.absScoreDiff]);
        if (match.status === "mismatch") mismatchedConf.push(conf);
        else matchedConf.push(conf);
      }
    }

    const range = rangeAcc.get(rangeOf(conf)!.id)!;
    range.total++;
    if (status === "accepted") range.accepted++;
    else if (status === "corrected") range.corrected++;
    else range.notReviewed++;
    if (reviewed) range.reviewed++;
    if (match) {
      if (match.status === "exact") range.exact++;
      else if (match.status === "partial") range.partial++;
      else range.mismatch++;
      rangeAbsDiffs.get(range.id)!.push(match.absScoreDiff);
    }

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
    row.avgScoreDiff = avg(rangeAbsDiffs.get(r.id)!);
    return row;
  });

  const total = rows.length;
  const reviewed = accepted + corrected;
  const noConfidence = total - withConfidence;
  const comparable = mExact + mPartial + mMismatch;

  const r = pearson(correlationPairs);
  const n = correlationPairs.length;
  const interp = interpretCorrelation(r, n);

  const rDiff = pearson(correlationDiffPairs);
  const nDiff = correlationDiffPairs.length;

  const byAccountant: AccountantConfidenceRow[] = [...accMap.entries()]
    .map(([accountant, a]) => ({
      accountant,
      reviewed: a.reviewed,
      accepted: a.accepted,
      corrected: a.corrected,
      correctionPct: correctionPct(a.corrected, a.reviewed),
      avgConfidence: avg(a.conf),
      avgAbsScoreDiff: avg(a.absDiff),
      high90Corrected: a.high90Corrected,
    }))
    .sort((x, y) => y.corrected - x.corrected || y.reviewed - x.reviewed);

  detailed.sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : Math.abs(y.scoreDiff ?? 0) - Math.abs(x.scoreDiff ?? 0)));

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
    avgConfidence: avg(allConf),
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
      accuracyPct: high.reviewed > 0 ? round1((high.accepted / high.reviewed) * 100) : null,
    },
    matches: {
      comparable,
      exact: mExact,
      partial: mPartial,
      mismatch: mMismatch,
      matched: mExact + mPartial,
      excludedNoBaseline,
      exactPct: comparable > 0 ? pct(mExact, comparable) : null,
      acceptablePct: comparable > 0 ? pct(mExact + mPartial, comparable) : null,
      mismatchPct: comparable > 0 ? pct(mMismatch, comparable) : null,
      avgScoreDiff: avg(signedDiffs),
      avgAbsScoreDiff: avg(absDiffs),
      medianScoreDiff: signedDiffs.length ? round1(median(signedDiffs)) : null,
      avgConfidenceMatched: avg(matchedConf),
      avgConfidenceMismatched: avg(mismatchedConf),
    },
    correlation: {
      r: r == null ? null : Math.round(r * 1000) / 1000,
      n,
      interpretation: interp.text,
      insufficient: interp.insufficient,
      warning: n < MIN_REVIEWED_FOR_CORRELATION ? INSUFFICIENT_DATA_MESSAGE : null,
    },
    correlationScoreDiff: {
      r: rDiff == null ? null : Math.round(rDiff * 1000) / 1000,
      n: nDiff,
      interpretation: interpretScoreDiffCorrelation(rDiff),
      insufficient: nDiff < MIN_REVIEWED_FOR_CORRELATION,
      warning: nDiff < MIN_REVIEWED_FOR_CORRELATION ? INSUFFICIENT_DATA_MESSAGE : null,
    },
    byAccountant,
    detailed,
    filters,
  };
}

/** RU interpretation of the confidence ↔ |score diff| correlation. */
function interpretScoreDiffCorrelation(r: number | null): string {
  if (r == null)
    return "Связь не определена: недостаточно разброса в данных.";
  if (r <= -0.1)
    return "Отрицательная корреляция: чем выше уверенность, тем меньше правка балла Маргаритой — уверенность откалибрована ожидаемо.";
  if (r >= 0.1)
    return "Положительная корреляция: более уверенные оценки правятся сильнее по баллам — уверенность, возможно, завышена.";
  return "Корреляция близка к нулю: связи между уверенностью и величиной правки не выявлено.";
}
