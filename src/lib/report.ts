// Pure aggregation for the daily / per-accountant report. Kept separate from
// data access so it is trivially unit-testable.
import type { Chat, Evaluation } from "./types";
import { bandFor, type QualityBand } from "./scoring";

export interface ReportFilters {
  from?: string; // ISO date inclusive
  to?: string; // ISO date inclusive
  accountant?: string;
  client?: string; // matches chat agr_no or chat_name (substring)
}

export interface AccountantBreakdown {
  accountant: string;
  avgScore: number; // 0..100
  count: number; // evaluations counted
  lowCount: number; // evaluations in Плохо/Критично
}

export interface DailyReport {
  filters: ReportFilters;
  totals: {
    activeChats: number; // Активных чатов
    newChats: number; // Новых чатов (created in range)
    chatsWithoutResponsible: number; // Чаты без ответственных
    evaluatedChats: number; // Оценено чатов всего
  };
  distribution: Record<QualityBand, number>; // Отлично/Хорошо/Плохо/Критично
  serviceQualityPct: number; // "Сервис Бухгалтерии" overall %
  perAccountant: AccountantBreakdown[];
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
  filters: ReportFilters
): DailyReport {
  const { from, to, accountant, client } = filters;

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

  // Evaluations filtered by date range + accountant + client.
  const evals = evaluations.filter((e) => {
    if (!inRange(e.checking_date, from, to)) return false;
    if (accountant && e.accountant !== accountant) return false;
    if (!matchesClient(e.chat_agr_no)) return false;
    return true;
  });

  // Chats filtered by accountant + client (for the totals block).
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
  for (const e of evals) {
    distribution[bandFor(e.total_score)] += 1;
  }

  // Per-accountant breakdown.
  const byAcc = new Map<string, { sum: number; count: number; low: number }>();
  for (const e of evals) {
    const key = e.accountant ?? "—";
    const agg = byAcc.get(key) ?? { sum: 0, count: 0, low: 0 };
    agg.sum += e.total_score;
    agg.count += 1;
    const band = bandFor(e.total_score);
    if (band === "Плохо" || band === "Критично") agg.low += 1;
    byAcc.set(key, agg);
  }
  const perAccountant: AccountantBreakdown[] = [...byAcc.entries()]
    .map(([name, a]) => ({
      accountant: name,
      avgScore: a.count ? Math.round((a.sum / a.count) * 10) / 10 : 0,
      count: a.count,
      lowCount: a.low,
    }))
    .sort((x, y) => y.avgScore - x.avgScore);

  const evaluatedChats = new Set(evals.map((e) => e.chat_agr_no)).size;
  const totalScoreSum = evals.reduce((s, e) => s + e.total_score, 0);
  const serviceQualityPct = evals.length
    ? Math.round((totalScoreSum / evals.length) * 10) / 10
    : 0;

  return {
    filters,
    totals: {
      activeChats: scopedChats.filter((c) => c.status === "Active").length,
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
  };
}
