// Pure aggregation for the daily / per-accountant report, mirroring the
// "Отчет" tab: a "Сервис Бухгалтерии" block (chat scores) and a "Задачи
// Бухгалтерии" block (single tasks). Kept separate from data access so it is
// trivially unit-testable.
import type { Chat, Evaluation, Task } from "./types";
import {
  bandFor,
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

export interface DailyReport {
  filters: ReportFilters;
  totals: {
    activeChats: number;
    newChats: number;
    chatsWithoutResponsible: number;
    evaluatedChats: number;
  };
  distribution: Record<QualityBand, number>;
  serviceQualityPct: number; // "Сервис Бухгалтерии" %
  perAccountant: AccountantScore[];
  /** Who Margarita should follow up with, most urgent first. May be empty. */
  needsAttention: AttentionItem[];
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

function inRange(date: string | null, from?: string, to?: string): boolean {
  if (!date) return false;
  const d = date.slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
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

  return {
    filters,
    totals: {
      // Genuinely active = status flag "Active" AND real activity within the
      // window as of `asOf` (not just the static flag).
      activeChats: scopedChats.filter(
        (c) => c.status === "Active" && !isStaleActivity(lastActivityOf(c), asOf)
      ).length,
      newChats: scopedChats.filter((c) => inRange(c.created_date, from, to))
        .length,
      chatsWithoutResponsible: scopedChats.filter(
        (c) => c.status === "Active" && !c.accountant
      ).length,
      evaluatedChats,
    },
    distribution,
    serviceQualityPct,
    perAccountant,
    needsAttention,
    tasks: {
      total: scopedTasks.length,
      onTime: tOnTime,
      late: tLate,
      overdue: tOverdue,
      perAccountant: tasksPerAccountant,
    },
  };
}
