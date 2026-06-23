// Pure aggregation for the daily / per-accountant report, mirroring the
// "Отчет" tab: a "Сервис Бухгалтерии" block (chat scores) and a "Задачи
// Бухгалтерии" block (single tasks). Kept separate from data access so it is
// trivially unit-testable.
import type { Chat, Evaluation, Task } from "./types";
import {
  bandFor,
  daysBetween,
  failingMailings,
  isStaleActivity,
  isTaskLate,
  isTaskOnTime,
  isTaskOverdue,
  type QualityBand,
} from "./scoring";

export interface ReportFilters {
  from?: string; // ISO date inclusive
  to?: string; // ISO date inclusive
  accountant?: string;
  client?: string; // matches chat agr_no or chat name (substring)
}

export interface AccountantScore {
  accountant: string;
  avgScore: number; // 0..100, -1 means "no evaluations"
  count: number;
  lowCount: number; // Плохо + Критично
}

export interface AccountantTasks {
  accountant: string;
  total: number;
  onTime: number;
  late: number;
  overdue: number;
}

/**
 * One person Margarita should follow up with, with the reason(s) why. Consolidates
 * the danger signals that today are scattered across two tables (a weak average,
 * any critical chat, overdue tasks) into a single coaching to-do list.
 */
export interface AttentionItem {
  accountant: string;
  avgScore: number; // 0..100, -1 when flagged only for tasks (no evaluations)
  band: QualityBand | null;
  lowCount: number; // Плохо + Критично evaluations
  criticalCount: number; // Критично evaluations
  overdueTasks: number;
  reasons: string[]; // short human-readable Russian reasons
}

/**
 * A single chat that scored Критично in the period — the actionable list of
 * "what actually went wrong today", with a short reason (failing mailing, weak
 * criterion, or the reviewer's comment) so Margarita can open it and coach.
 */
export interface CriticalChat {
  chat_agr_no: string;
  chat_name: string | null;
  accountant: string | null;
  score: number; // 0..100
  reasons: string[]; // short Russian reasons, most specific first
}

/**
 * A live chat still awaiting a reply (the client had the last word). This is a
 * current-state service signal — it is NOT tied to the report's date window.
 */
export interface UnansweredChat {
  chat_agr_no: string;
  chat_name: string | null;
  accountant: string | null;
  /** Whole days the client has been waiting, relative to `asOf` (null if unknown). */
  waitingDays: number | null;
}

export interface DaySummary {
  date: string;
  evaluatedChats: number;
  newChats: number;
  distribution: Record<QualityBand, number>;
  serviceQualityPct: number;
}

export interface DayAccountantScore {
  date: string;       // ISO yyyy-mm-dd
  accountant: string;
  avgScore: number;   // 0..100
  count: number;
}

export interface DailyReport {
  filters: ReportFilters;
  totals: {
    activeChats: number;
    newChats: number;
    chatsWithoutResponsible: number;
    evaluatedChats: number;
    /** Live chats where the client had the last word (still unanswered). */
    unansweredChats: number;
  };
  /**
   * Share of the live book that was actually reviewed in the window:
   * evaluatedChats ÷ activeChats × 100. Surfaces "we only checked N% of active
   * chats today" — a blind-spot metric the old report never showed.
   */
  coveragePct: number;
  distribution: Record<QualityBand, number>;
  serviceQualityPct: number; // "Сервис Бухгалтерии" %
  perAccountant: AccountantScore[];
  /**
   * Chat-quality scores for the non-accountant roles (item 3 — a manager or
   * lawyer who answers in a chat is now graded on the same criteria and shows
   * up here, instead of falling out of QA entirely). Optional so snapshots saved
   * before this existed still render.
   */
  managerScores?: AccountantScore[];
  lawyerScores?: AccountantScore[];
  /** Who Margarita should follow up with, most urgent first. May be empty. */
  needsAttention: AttentionItem[];
  /** Chats that scored Критично in the window, worst score first. May be empty. */
  criticalChats: CriticalChat[];
  /** Live chats still awaiting a reply, longest wait first. May be empty. */
  unansweredChats: UnansweredChat[];
  /** Per-day × per-accountant scores; populated for multi-day windows (weekly view, stars). */
  perDayPerAccountant?: DayAccountantScore[];
  /** Per-day aggregate metrics (evaluated count, distribution, service %); multi-day only. */
  perDay?: DaySummary[];
  tasks: {
    total: number;
    onTime: number;
    late: number;
    overdue: number;
    perAccountant: AccountantTasks[];
  };
}

/** A saved Отчёт, stored in history so a past period can be re-opened as-was. */
export interface ReportSnapshot {
  id: string;
  label: string;
  filters: ReportFilters;
  report: DailyReport;
  created_by: string | null;
  created_at: string; // ISO timestamp
}

/** Human label for a snapshot, derived from its filters (e.g. "01.05–31.05"). */
export function reportSnapshotLabel(filters: ReportFilters): string {
  const fmt = (d?: string) => (d ? d.split("-").reverse().join(".") : "");
  let range: string;
  if (filters.from && filters.to)
    range =
      filters.from === filters.to
        ? fmt(filters.from)
        : `${fmt(filters.from)}–${fmt(filters.to)}`;
  else if (filters.from) range = `с ${fmt(filters.from)}`;
  else if (filters.to) range = `по ${fmt(filters.to)}`;
  else range = "весь период";
  const extra = [filters.accountant, filters.client].filter(Boolean).join(", ");
  return extra ? `${range} · ${extra}` : range;
}

/** ISO date `iso` shifted by `delta` days (negative = earlier). */
export function addDays(iso: string, delta: number): string {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * The comparison window immediately preceding [from, to], used for trend (▲/▼).
 * For a single day, snap to the previous day that actually has data (`evalDates`,
 * ascending) so the trend isn't lost to weekends/gaps. For a range, take the
 * equally-long block ending the day before `from`.
 */
export function precedingWindow(
  from: string,
  to: string,
  evalDates: string[] = []
): { from: string; to: string } | null {
  if (from === to) {
    const prev = evalDates.filter((d) => d < from).pop();
    return prev ? { from: prev, to: prev } : { from: addDays(from, -1), to: addDays(from, -1) };
  }
  const span = daysBetween(from, to); // inclusive length − 1
  const pto = addDays(from, -1);
  return { from: addDays(pto, -span), to: pto };
}

function inRange(date: string | null, from?: string, to?: string): boolean {
  if (!date) return false;
  const d = date.slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

/**
 * Short, human reasons why a chat scored Критично, most specific first:
 *   1. a failing mandatory mailing (the hard gate) — "Первичка: Не запросил 1";
 *   2. weak criteria below full marks — "Точность 3/5";
 *   3. the reviewer's comment (trimmed);
 * Falls back to an empty list (the caller still shows the score). Imported rows
 * can carry a low total with none of the above, so every branch is optional.
 */
function criticalReasons(ev: Evaluation): string[] {
  const reasons: string[] = [];
  for (const f of failingMailings(ev.scores?.monthly)) {
    reasons.push(`${f.category}: ${f.status}`);
  }
  if (reasons.length === 0) {
    const crit = ev.scores?.criteria;
    if (crit) {
      if (typeof crit.accuracy === "number" && crit.accuracy < 5)
        reasons.push(`Точность ${crit.accuracy}/5`);
      if (typeof crit.sla === "number" && crit.sla < 5)
        reasons.push(`SLA ${crit.sla}/5`);
    }
  }
  if (reasons.length === 0 && ev.comment?.trim()) {
    const c = ev.comment.trim();
    reasons.push(c.length > 80 ? `${c.slice(0, 77)}…` : c);
  }
  return reasons;
}

/**
 * Per-person chat-quality summary (avg %, count, low count) for an already
 * window-filtered set of evaluations. Used for the manager / lawyer roster so a
 * non-accountant who answers in a chat is graded on the same model and shows up
 * in the report (item 3).
 */
export function perPersonScores(evals: Evaluation[]): AccountantScore[] {
  const byPerson = new Map<string, { sum: number; count: number; low: number }>();
  for (const e of evals) {
    const key = e.accountant ?? "—";
    const agg = byPerson.get(key) ?? { sum: 0, count: 0, low: 0 };
    agg.sum += e.total_score;
    agg.count += 1;
    const band = bandFor(e.total_score);
    if (band === "Плохо" || band === "Критично") agg.low += 1;
    byPerson.set(key, agg);
  }
  return [...byPerson.entries()]
    .map(([accountant, a]) => ({
      accountant,
      avgScore: a.count ? Math.round((a.sum / a.count) * 10) / 10 : -1,
      count: a.count,
      lowCount: a.low,
    }))
    .sort((x, y) => y.avgScore - x.avgScore);
}

export function buildReport(
  chats: Chat[],
  evaluations: Evaluation[],
  filters: ReportFilters,
  tasks: Task[] = [],
  /** Reference day for the "is this chat still active?" check (default: today). */
  asOf: string = new Date().toISOString().slice(0, 10)
): DailyReport {
  const { from, to, accountant, client } = filters;

  // Last REAL activity per chat: the chat's own activity date, else the latest
  // task touch. Used so "Активных чатов" counts chats that are genuinely live —
  // not ones whose status flag still says "Active" but went quiet days ago.
  const lastTaskByChat = new Map<string, string>();
  for (const t of tasks) {
    const d = (t.checking_date ?? t.due_date_original ?? "").slice(0, 10);
    if (!d) continue;
    const cur = lastTaskByChat.get(t.chat_agr_no);
    if (!cur || d > cur) lastTaskByChat.set(t.chat_agr_no, d);
  }
  const lastActivityOf = (c: Chat): string | null =>
    c.last_activity_date ?? lastTaskByChat.get(c.agr_no) ?? null;

  const chatById = new Map(chats.map((c) => [c.agr_no, c]));
  const matchesClient = (agrNo: string): boolean => {
    if (!client) return true;
    const c = chatById.get(agrNo);
    const needle = client.toLowerCase();
    return (
      agrNo.toLowerCase().includes(needle) ||
      (c?.chat_name ?? "").toLowerCase().includes(needle) ||
      (c?.name_agr ?? "").toLowerCase().includes(needle)
    );
  };

  const evals = evaluations.filter((e) => {
    if (!inRange(e.checking_date, from, to)) return false;
    if (accountant && e.accountant !== accountant) return false;
    if (!matchesClient(e.chat_agr_no)) return false;
    return true;
  });

  const scopedChats = chats.filter((c) => {
    if (accountant && c.accountant !== accountant) return false;
    if (!matchesClient(c.agr_no)) return false;
    return true;
  });

  const distribution: Record<QualityBand, number> = {
    Отлично: 0,
    Хорошо: 0,
    Плохо: 0,
    Критично: 0,
  };
  for (const e of evals) distribution[bandFor(e.total_score)] += 1;

  // Per-accountant chat scores.
  const byAcc = new Map<
    string,
    { sum: number; count: number; low: number; crit: number }
  >();
  for (const e of evals) {
    const key = e.accountant ?? "—";
    const agg = byAcc.get(key) ?? { sum: 0, count: 0, low: 0, crit: 0 };
    agg.sum += e.total_score;
    agg.count += 1;
    const band = bandFor(e.total_score);
    if (band === "Плохо" || band === "Критично") agg.low += 1;
    if (band === "Критично") agg.crit += 1;
    byAcc.set(key, agg);
  }
  const perAccountant: AccountantScore[] = [...byAcc.entries()]
    .map(([name, a]) => ({
      accountant: name,
      avgScore: a.count ? Math.round((a.sum / a.count) * 10) / 10 : -1,
      count: a.count,
      lowCount: a.low,
    }))
    .sort((x, y) => y.avgScore - x.avgScore);

  const evaluatedChats = new Set(evals.map((e) => e.chat_agr_no)).size;
  const totalScoreSum = evals.reduce((s, e) => s + e.total_score, 0);
  const serviceQualityPct = evals.length
    ? Math.round((totalScoreSum / evals.length) * 10) / 10
    : 0;

  // Critical chats — the actionable "what went wrong" list. One row per chat
  // (its LATEST evaluation per day, worst score first).
  // Use latest-per-(chat,date) so that a re-score on the same day replaces the
  // old one: if a chat was marked Критично, then re-evaluated as good, it drops
  // off the list without needing a manual remove. (Bug fix: previously the
  // "worst" was used, so a later good score didn't clear the critical flag.)
  const latestByKey = new Map<string, Evaluation>();
  for (const e of evals) {
    const key = `${e.chat_agr_no}|${e.checking_date.slice(0, 10)}`;
    const cur = latestByKey.get(key);
    if (!cur || e.created_at > cur.created_at) latestByKey.set(key, e);
  }
  const worstByChat = new Map<string, Evaluation>();
  for (const e of latestByKey.values()) {
    if (bandFor(e.total_score) !== "Критично") continue;
    const cur = worstByChat.get(e.chat_agr_no);
    if (!cur || e.total_score < cur.total_score) worstByChat.set(e.chat_agr_no, e);
  }
  const criticalChats: CriticalChat[] = [...worstByChat.values()]
    .map((e) => ({
      chat_agr_no: e.chat_agr_no,
      chat_name: chatById.get(e.chat_agr_no)?.chat_name ?? null,
      accountant: e.accountant,
      score: e.total_score,
      reasons: criticalReasons(e),
    }))
    .sort((a, b) => a.score - b.score || a.chat_agr_no.localeCompare(b.chat_agr_no));

  // Unanswered chats — current-state service backlog (client had the last word).
  // Independent of the date window: it is "who is waiting right now".
  const unansweredChats: UnansweredChat[] = scopedChats
    .filter((c) => c.status === "Active" && c.unanswered === true)
    .map((c) => {
      const last = lastActivityOf(c);
      return {
        chat_agr_no: c.agr_no,
        chat_name: c.chat_name ?? null,
        accountant: c.accountant,
        waitingDays: last ? Math.max(0, daysBetween(last, asOf)) : null,
      };
    })
    .sort(
      (a, b) =>
        (b.waitingDays ?? -1) - (a.waitingDays ?? -1) ||
        a.chat_agr_no.localeCompare(b.chat_agr_no)
    );

  // Tasks block.
  const scopedTasks = tasks.filter((t) => {
    const d = t.checking_date ?? t.completed_at ?? t.due_date_original;
    if (!inRange(d ?? null, from, to)) return false;
    if (accountant && t.accountant !== accountant) return false;
    if (!matchesClient(t.chat_agr_no)) return false;
    return true;
  });
  const taskByAcc = new Map<
    string,
    { total: number; onTime: number; late: number; overdue: number }
  >();
  let tOnTime = 0,
    tLate = 0,
    tOverdue = 0;
  for (const t of scopedTasks) {
    const key = t.accountant ?? "—";
    const agg = taskByAcc.get(key) ?? { total: 0, onTime: 0, late: 0, overdue: 0 };
    agg.total += 1;
    if (isTaskOnTime(t.task_status)) {
      agg.onTime += 1;
      tOnTime += 1;
    } else if (isTaskLate(t.task_status)) {
      agg.late += 1;
      tLate += 1;
    } else if (isTaskOverdue(t.task_status)) {
      agg.overdue += 1;
      tOverdue += 1;
    }
    taskByAcc.set(key, agg);
  }
  const tasksPerAccountant: AccountantTasks[] = [...taskByAcc.entries()]
    .map(([accountant, a]) => ({ accountant, ...a }))
    .sort((x, y) => y.total - x.total);

  // "Требует внимания" — the coaching to-do list. Flag a person when their
  // average lands in a weak band (Плохо/Критично), they have a critical chat,
  // or they have overdue tasks. Most urgent first.
  const overdueByAcc = new Map<string, number>();
  for (const [acc, a] of taskByAcc) if (a.overdue > 0) overdueByAcc.set(acc, a.overdue);

  const attentionKeys = new Set<string>();
  for (const [acc, a] of byAcc) {
    const band = bandFor(a.sum / a.count);
    if (a.crit > 0 || band === "Плохо" || band === "Критично") attentionKeys.add(acc);
  }
  for (const acc of overdueByAcc.keys()) attentionKeys.add(acc);

  const needsAttention: AttentionItem[] = [...attentionKeys]
    .map((accountant): AttentionItem => {
      const s = byAcc.get(accountant);
      const avgScore = s && s.count ? Math.round((s.sum / s.count) * 10) / 10 : -1;
      const band = avgScore >= 0 ? bandFor(avgScore) : null;
      const criticalCount = s?.crit ?? 0;
      const lowCount = s?.low ?? 0;
      const overdueTasks = overdueByAcc.get(accountant) ?? 0;
      const reasons: string[] = [];
      if (band === "Критично" || band === "Плохо")
        reasons.push(`средняя ${avgScore}% — ${band}`);
      if (criticalCount > 0) reasons.push(`критичных чатов: ${criticalCount}`);
      if (overdueTasks > 0) reasons.push(`просрочено задач: ${overdueTasks}`);
      return { accountant, avgScore, band, lowCount, criticalCount, overdueTasks, reasons };
    })
    .sort((x, y) => {
      if (y.criticalCount !== x.criticalCount) return y.criticalCount - x.criticalCount;
      if (y.overdueTasks !== x.overdueTasks) return y.overdueTasks - x.overdueTasks;
      const ax = x.avgScore < 0 ? 101 : x.avgScore;
      const ay = y.avgScore < 0 ? 101 : y.avgScore;
      return ax - ay;
    });

  // Genuinely active = status flag "Active" AND real activity within the window
  // as of `asOf` (not just the static flag).
  const activeChats = scopedChats.filter(
    (c) => c.status === "Active" && !isStaleActivity(lastActivityOf(c), asOf)
  ).length;
  const coveragePct = activeChats
    ? Math.round((evaluatedChats / activeChats) * 1000) / 10
    : 0;

  // Per-day × per-accountant scores AND per-day aggregates — used for the
  // weekly report visual table, stars, and the spreadsheet comparison view.
  // Only computed for multi-day windows.
  let perDayPerAccountant: DayAccountantScore[] | undefined;
  let perDay: DaySummary[] | undefined;
  if (from !== to) {
    const dayAccMap = new Map<string, Map<string, { sum: number; count: number }>>();
    const dayMap = new Map<string, { sum: number; count: number; dist: Record<QualityBand, number> }>();
    for (const e of evals) {
      const date = e.checking_date.slice(0, 10);
      const acc = e.accountant ?? "—";
      if (!dayAccMap.has(date)) dayAccMap.set(date, new Map());
      const accMap = dayAccMap.get(date)!;
      const accAgg = accMap.get(acc) ?? { sum: 0, count: 0 };
      accAgg.sum += e.total_score;
      accAgg.count += 1;
      accMap.set(acc, accAgg);
      if (!dayMap.has(date)) {
        dayMap.set(date, { sum: 0, count: 0, dist: { Отлично: 0, Хорошо: 0, Плохо: 0, Критично: 0 } });
      }
      const dayAgg = dayMap.get(date)!;
      dayAgg.sum += e.total_score;
      dayAgg.count += 1;
      dayAgg.dist[bandFor(e.total_score)] += 1;
    }
    perDayPerAccountant = [];
    for (const [date, accMap] of [...dayAccMap.entries()].sort()) {
      for (const [accountant, a] of [...accMap.entries()].sort()) {
        perDayPerAccountant.push({
          date,
          accountant,
          avgScore: Math.round((a.sum / a.count) * 10) / 10,
          count: a.count,
        });
      }
    }
    const dayNewChats = new Map<string, number>();
    for (const c of scopedChats) {
      if (c.created_date) {
        const d = c.created_date.slice(0, 10);
        if ((!from || d >= from) && (!to || d <= to)) {
          dayNewChats.set(d, (dayNewChats.get(d) ?? 0) + 1);
        }
      }
    }
    perDay = [...dayMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, a]) => ({
        date,
        evaluatedChats: a.count,
        newChats: dayNewChats.get(date) ?? 0,
        distribution: a.dist,
        serviceQualityPct: a.count ? Math.round((a.sum / a.count) * 10) / 10 : 0,
      }));
  }

  return {
    filters,
    totals: {
      activeChats,
      newChats: scopedChats.filter((c) => inRange(c.created_date, from, to))
        .length,
      chatsWithoutResponsible: scopedChats.filter(
        (c) => c.status === "Active" && !c.accountant
      ).length,
      evaluatedChats,
      unansweredChats: unansweredChats.length,
    },
    coveragePct,
    distribution,
    serviceQualityPct,
    perAccountant,
    needsAttention,
    criticalChats,
    unansweredChats,
    perDayPerAccountant,
    perDay,
    tasks: {
      total: scopedTasks.length,
      onTime: tOnTime,
      late: tLate,
      overdue: tOverdue,
      perAccountant: tasksPerAccountant,
    },
  };
}
