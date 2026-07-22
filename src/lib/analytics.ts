// ---------------------------------------------------------------------------
// QA Analytics — единый чистый агрегатор для аналитического дашборда, отчёта по
// работе и краткого Telegram-отчёта за период (день / неделя / месяц / диапазон).
//
// Источники — ТОЛЬКО реальные записи БД (те же, что и на остальных страницах,
// чтобы цифры совпадали везде):
//   • mqa_evaluations (role='accountant')       → оценки, качество, кол-во чатов;
//   • mqa_violations (confirmed !== false)       → нарушения (ручные, подтв.);
//   • mqa_violation_appeals                      → апелляции и их решения.
//
// Всё считается по «бухгалтеру × периоду» И по «бухгалтеру × дню», чтобы
// историческая суточная разбивка не терялась при новых проверках (каждый день
// хранится отдельной строкой оценки — старые дни не перезаписываются).
//
// Модуль DB-free и покрыт юнит-тестами (tests/analytics.test.ts): агрегаты здесь
// обязаны совпадать с buildReport / buildViolationWorkflowReport на тех же данных.
// ---------------------------------------------------------------------------
import { bandFor, type QualityBand } from "./scoring";
import { findEmployee, normalizeName } from "./valid-employees";
import type { Evaluation, Violation, ViolationAppeal } from "./types";

/** Порог «мало данных»: ранжировать по средней оценке имеет смысл только при
 *  достаточном числе проверенных чатов — иначе 1 отличный чат = «лучший месяца».
 *  Ниже порога бухгалтер помечается `lowSample` и не участвует в звании
 *  «лучший / худший», но остаётся в таблицах и рейтингах по объёму. */
export const MIN_CHATS_FOR_RANKING = 3;

export interface AccountantAnalytics {
  accountant: string;
  /** Средняя оценка 0..100; -1 = не было оценок за период. */
  avgScore: number;
  /** Кол-во строк-оценок (проверок). */
  evaluations: number;
  /** Кол-во уникальных проверенных чатов. */
  chatsChecked: number;
  /** Оценки в бэнде «Отлично». */
  excellent: number;
  /** Оценки в бэнде «Хорошо». */
  good: number;
  /** Оценки в бэнде «Плохо» — предупреждения по качеству. */
  warnings: number;
  /** Оценки в бэнде «Критично» — критические проблемы. */
  critical: number;
  /** Подтверждённые нарушения (записи mqa_violations). */
  violations: number;
  /** Подано апелляций за период. */
  appeals: number;
  appealsApproved: number;
  appealsRejected: number;
  appealsPending: number;
  /** true, если проверено < MIN_CHATS_FOR_RANKING чатов (ранжирование по
   *  средней ненадёжно — не делаем громких выводов). */
  lowSample: boolean;
}

export interface DayAccountantAnalytics {
  date: string; // ISO yyyy-mm-dd
  accountant: string;
  avgScore: number; // 0..100
  evaluations: number;
  chatsChecked: number;
  warnings: number;
  critical: number;
  violations: number;
  appeals: number;
  appealsApproved: number;
  appealsRejected: number;
}

export interface DayTotals {
  date: string;
  avgScore: number; // 0..100, среднее по отделу за день (-1 если нет оценок)
  evaluations: number;
  chatsChecked: number;
  violations: number;
  appeals: number;
}

export interface AnalyticsRankingItem {
  accountant: string;
  value: number;
  lowSample: boolean;
}

export interface AnalyticsTotals {
  accountantsReviewed: number; // бухгалтеров с ≥1 оценкой
  chatsChecked: number; // уникальных чатов
  evaluations: number;
  avgScore: number; // 0..100 по отделу (-1 если нет оценок)
  excellent: number;
  good: number;
  warnings: number;
  critical: number;
  violations: number;
  appeals: number;
  appealsApproved: number;
  appealsRejected: number;
  appealsPending: number;
}

export interface AnalyticsReport {
  period: { from: string; to: string; label: string };
  totals: AnalyticsTotals;
  perAccountant: AccountantAnalytics[]; // отсортированы по средней (лучшие сверху)
  perDayPerAccountant: DayAccountantAnalytics[];
  perDay: DayTotals[]; // по возрастанию даты — тренд по отделу
  rankings: {
    /** Лучший по средней (с достаточной выборкой), null если некого. */
    topByScore: AnalyticsRankingItem | null;
    /** Худший по средней (с достаточной выборкой), null если некого. */
    bottomByScore: AnalyticsRankingItem | null;
    mostChats: AnalyticsRankingItem | null;
    mostViolations: AnalyticsRankingItem | null;
  };
}

export interface AnalyticsInput {
  evaluations: Evaluation[]; // уже отфильтрованы по роли accountant и окну
  violations: Violation[]; // окно + accountant
  appeals: ViolationAppeal[]; // окно (по created_at) + accountant
  from: string;
  to: string;
}

function fmtRange(from: string, to: string): string {
  const fmt = (d: string) => d.split("-").reverse().join(".");
  return from === to ? fmt(from) : `${fmt(from)}–${fmt(to)}`;
}

/** Каноническое имя для слияния оценок/нарушений/апелляций одного человека
 *  (в разных таблицах имена бывают короткими армянскими / полными). */
function canonKey(name: string | null | undefined): string {
  const emp = findEmployee(name);
  return emp ? emp.short : normalizeName(name) || "—";
}
function canonDisplay(name: string | null | undefined): string {
  const emp = findEmployee(name);
  return emp ? emp.canonical : (name || "").trim() || "— Не назначено —";
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function inRange(iso: string | null | undefined, from: string, to: string): boolean {
  if (!iso) return false;
  const d = iso.slice(0, 10);
  return d >= from && d <= to;
}

interface Acc {
  display: string;
  sum: number;
  evaluations: number;
  chats: Set<string>;
  excellent: number;
  good: number;
  warnings: number;
  critical: number;
  violations: number;
  appeals: number;
  appealsApproved: number;
  appealsRejected: number;
  appealsPending: number;
}

function emptyAcc(display: string): Acc {
  return {
    display,
    sum: 0,
    evaluations: 0,
    chats: new Set(),
    excellent: 0,
    good: 0,
    warnings: 0,
    critical: 0,
    violations: 0,
    appeals: 0,
    appealsApproved: 0,
    appealsRejected: 0,
    appealsPending: 0,
  };
}

function bandBucket(agg: Acc, band: QualityBand) {
  if (band === "Отлично") agg.excellent += 1;
  else if (band === "Хорошо") agg.good += 1;
  else if (band === "Плохо") agg.warnings += 1;
  else agg.critical += 1;
}

/**
 * Построить полный аналитический отчёт из реальных записей за уже разрешённое
 * окно [from, to]. Оценки берём как есть (role=accountant); нарушения —
 * подтверждённые; апелляции — уже отфильтрованы по created_at в окне.
 */
export function buildAnalytics(input: AnalyticsInput): AnalyticsReport {
  const { from, to } = input;
  const evals = input.evaluations.filter((e) => inRange(e.checking_date, from, to));
  const violations = input.violations.filter(
    (v) => v.confirmed !== false && inRange(v.vdate, from, to)
  );
  const appeals = input.appeals.filter((a) => inRange(a.created_at, from, to));

  const byAcc = new Map<string, Acc>();
  const accFor = (name: string | null | undefined): Acc => {
    const key = canonKey(name);
    let a = byAcc.get(key);
    if (!a) {
      a = emptyAcc(canonDisplay(name));
      byAcc.set(key, a);
    }
    return a;
  };

  // Per-day×accountant scaffolding: key = `${date}|${canonKey}`.
  const dayAcc = new Map<
    string,
    {
      date: string;
      display: string;
      sum: number;
      evaluations: number;
      chats: Set<string>;
      warnings: number;
      critical: number;
      violations: number;
      appeals: number;
      appealsApproved: number;
      appealsRejected: number;
    }
  >();
  const dayAccFor = (date: string, name: string | null | undefined) => {
    const key = `${date}|${canonKey(name)}`;
    let d = dayAcc.get(key);
    if (!d) {
      d = {
        date,
        display: canonDisplay(name),
        sum: 0,
        evaluations: 0,
        chats: new Set<string>(),
        warnings: 0,
        critical: 0,
        violations: 0,
        appeals: 0,
        appealsApproved: 0,
        appealsRejected: 0,
      };
      dayAcc.set(key, d);
    }
    return d;
  };

  // Per-day department totals.
  const dayTot = new Map<
    string,
    { sum: number; evaluations: number; chats: Set<string>; violations: number; appeals: number }
  >();
  const dayTotFor = (date: string) => {
    let d = dayTot.get(date);
    if (!d) {
      d = { sum: 0, evaluations: 0, chats: new Set<string>(), violations: 0, appeals: 0 };
      dayTot.set(date, d);
    }
    return d;
  };

  // --- Evaluations → scores / bands / chats -------------------------------
  const totals: AnalyticsTotals = {
    accountantsReviewed: 0,
    chatsChecked: 0,
    evaluations: 0,
    avgScore: -1,
    excellent: 0,
    good: 0,
    warnings: 0,
    critical: 0,
    violations: 0,
    appeals: 0,
    appealsApproved: 0,
    appealsRejected: 0,
    appealsPending: 0,
  };
  const allChats = new Set<string>();
  let evalSum = 0;
  for (const e of evals) {
    const date = e.checking_date.slice(0, 10);
    const band = bandFor(e.total_score);
    const a = accFor(e.accountant);
    a.sum += e.total_score;
    a.evaluations += 1;
    if (e.chat_agr_no) a.chats.add(e.chat_agr_no);
    bandBucket(a, band);

    const d = dayAccFor(date, e.accountant);
    d.sum += e.total_score;
    d.evaluations += 1;
    if (e.chat_agr_no) d.chats.add(e.chat_agr_no);
    if (band === "Плохо") d.warnings += 1;
    else if (band === "Критично") d.critical += 1;

    const dt = dayTotFor(date);
    dt.sum += e.total_score;
    dt.evaluations += 1;
    if (e.chat_agr_no) dt.chats.add(e.chat_agr_no);

    evalSum += e.total_score;
    if (e.chat_agr_no) allChats.add(e.chat_agr_no);
    totals.evaluations += 1;
    if (band === "Отлично") totals.excellent += 1;
    else if (band === "Хорошо") totals.good += 1;
    else if (band === "Плохо") totals.warnings += 1;
    else totals.critical += 1;
  }

  // --- Violations ----------------------------------------------------------
  for (const v of violations) {
    const date = (v.vdate ?? "").slice(0, 10);
    const a = accFor(v.accountant);
    a.violations += 1;
    if (date) dayAccFor(date, v.accountant).violations += 1;
    if (date) dayTotFor(date).violations += 1;
    totals.violations += 1;
  }

  // --- Appeals -------------------------------------------------------------
  for (const ap of appeals) {
    const date = (ap.created_at ?? "").slice(0, 10);
    const a = accFor(ap.accountant);
    a.appeals += 1;
    const d = date ? dayAccFor(date, ap.accountant) : null;
    if (d) d.appeals += 1;
    if (date) dayTotFor(date).appeals += 1;
    totals.appeals += 1;
    if (ap.status === "approved") {
      a.appealsApproved += 1;
      if (d) d.appealsApproved += 1;
      totals.appealsApproved += 1;
    } else if (ap.status === "rejected") {
      a.appealsRejected += 1;
      if (d) d.appealsRejected += 1;
      totals.appealsRejected += 1;
    } else {
      a.appealsPending += 1;
      totals.appealsPending += 1;
    }
  }

  // --- Finalize per-accountant --------------------------------------------
  const perAccountant: AccountantAnalytics[] = [...byAcc.values()]
    .map((a) => ({
      accountant: a.display,
      avgScore: a.evaluations ? round1(a.sum / a.evaluations) : -1,
      evaluations: a.evaluations,
      chatsChecked: a.chats.size,
      excellent: a.excellent,
      good: a.good,
      warnings: a.warnings,
      critical: a.critical,
      violations: a.violations,
      appeals: a.appeals,
      appealsApproved: a.appealsApproved,
      appealsRejected: a.appealsRejected,
      appealsPending: a.appealsPending,
      lowSample: a.chats.size < MIN_CHATS_FOR_RANKING,
    }))
    // Убираем пустые агрегаты «— Не назначено —» без единого сигнала.
    .filter(
      (a) =>
        a.evaluations > 0 || a.violations > 0 || a.appeals > 0
    )
    .sort(
      (x, y) =>
        y.avgScore - x.avgScore ||
        y.chatsChecked - x.chatsChecked ||
        x.accountant.localeCompare(y.accountant)
    );

  totals.accountantsReviewed = perAccountant.filter((a) => a.evaluations > 0).length;
  totals.chatsChecked = allChats.size;
  totals.avgScore = totals.evaluations ? round1(evalSum / totals.evaluations) : -1;

  // --- Finalize per-day×accountant + per-day ------------------------------
  const perDayPerAccountant: DayAccountantAnalytics[] = [...dayAcc.values()]
    .map((d) => ({
      date: d.date,
      accountant: d.display,
      avgScore: d.evaluations ? round1(d.sum / d.evaluations) : -1,
      evaluations: d.evaluations,
      chatsChecked: d.chats.size,
      warnings: d.warnings,
      critical: d.critical,
      violations: d.violations,
      appeals: d.appeals,
      appealsApproved: d.appealsApproved,
      appealsRejected: d.appealsRejected,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.accountant.localeCompare(b.accountant));

  const perDay: DayTotals[] = [...dayTot.entries()]
    .map(([date, d]) => ({
      date,
      avgScore: d.evaluations ? round1(d.sum / d.evaluations) : -1,
      evaluations: d.evaluations,
      chatsChecked: d.chats.size,
      violations: d.violations,
      appeals: d.appeals,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // --- Rankings (с защитой от малой выборки для «лучший/худший») -----------
  const rankable = perAccountant.filter((a) => a.avgScore >= 0 && !a.lowSample);
  const byScoreDesc = [...rankable].sort((a, b) => b.avgScore - a.avgScore);
  const topByScore = byScoreDesc[0]
    ? { accountant: byScoreDesc[0].accountant, value: byScoreDesc[0].avgScore, lowSample: false }
    : null;
  const bottomByScore = byScoreDesc.length
    ? {
        accountant: byScoreDesc[byScoreDesc.length - 1].accountant,
        value: byScoreDesc[byScoreDesc.length - 1].avgScore,
        lowSample: false,
      }
    : null;

  const mostChatsRow = [...perAccountant].sort((a, b) => b.chatsChecked - a.chatsChecked)[0];
  const mostChats =
    mostChatsRow && mostChatsRow.chatsChecked > 0
      ? { accountant: mostChatsRow.accountant, value: mostChatsRow.chatsChecked, lowSample: false }
      : null;

  const mostViolationsRow = [...perAccountant].sort((a, b) => b.violations - a.violations)[0];
  const mostViolations =
    mostViolationsRow && mostViolationsRow.violations > 0
      ? {
          accountant: mostViolationsRow.accountant,
          value: mostViolationsRow.violations,
          lowSample: false,
        }
      : null;

  return {
    period: { from, to, label: fmtRange(from, to) },
    totals,
    perAccountant,
    perDayPerAccountant,
    perDay,
    rankings: { topByScore, bottomByScore, mostChats, mostViolations },
  };
}
