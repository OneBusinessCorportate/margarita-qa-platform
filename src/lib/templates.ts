// ---------------------------------------------------------------------------
// Telegram message templates. v1 is COPY-TO-CLIPBOARD ONLY — no bot send.
// All wording lives here so it is trivial to edit in one place.
//
// Three kinds of message, matching what Margarita copies today:
//   1. buildReportMessage   — daily report (Сервис + Задачи Бухгалтерии).
//   2. buildScoreMessage    — per-chat / per-accountant evaluation.
//   3. surveyInvite*        — the AM/RU client survey invitation (typeform).
//
// TODO(margarita): confirm exact wording/format — pending her answer.
// A future "Send via bot" path can call sendToTelegram(text) guarded by
// telegramConfigured().
// ---------------------------------------------------------------------------

import type { DailyReport } from "./report";
import { MONTHLY_CATEGORIES, bandFor, failingMailings, type QualityBand } from "./scoring";
import type { Chat, Evaluation, Violation } from "./types";

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

function fmtDateRange(from?: string, to?: string): string {
  if (from && to && from === to) return from;
  if (from && to) return `${from} — ${to}`;
  if (from) return `с ${from}`;
  if (to) return `по ${to}`;
  return "за всё время";
}

/** DD.MM from an ISO date (for the report header). */
function fmtDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d && m ? `${d}.${m}` : iso;
}

// Colour cue per quality band, so each person's mark reads at a glance.
const BAND_EMOJI: Record<QualityBand, string> = {
  Отлично: "🟢",
  Хорошо: "🟡",
  Плохо: "🟠",
  Критично: "🔴",
};

export interface ReportMessageOptions {
  /** Violations for the period — grouped per accountant in the message. */
  violations?: Violation[];
  /** Optional Google-Sheet (or any) link appended at the end. */
  sheetUrl?: string;
  /** ISO date shown in the header; defaults to the filter's `to`, else today. */
  date?: string;
  /**
   * The preceding comparable period, for the ▲/▼ trend on the service line.
   * Supplied by getDailyAnalytics; omit to skip the trend.
   */
  previous?: DailyReport | null;
  /** Cap on how many rows each detail list prints before "+ ещё N". */
  maxList?: number;
}

/** "▲ +0.6 п.п. к 10.06" / "▼ −1.2 п.п." / "→ без изменений" vs the previous period. */
function fmtTrend(cur: number, prev: DailyReport | null | undefined): string {
  if (!prev) return "";
  const prevPct = prev.serviceQualityPct;
  const d = Math.round((cur - prevPct) * 10) / 10;
  const label = fmtDay(prev.filters.to ?? prev.filters.from ?? "");
  const to = label ? ` к ${label}` : "";
  if (d > 0) return `  ▲ +${d} п.п.${to}`;
  if (d < 0) return `  ▼ ${d} п.п.${to}`; // d already carries the minus sign
  return `  → без изменений${to}`;
}

/** Period label for the header: a single day, or "DD.MM — DD.MM" for a range. */
function periodHeader(report: DailyReport, dateISO: string): string {
  const { from, to } = report.filters;
  if (from && to && from !== to) return `${fmtDay(from)} — ${fmtDay(to)}`;
  return fmtDay(to ?? from ?? dateISO);
}

/** Pretty contract label "№123 Имя" (name trimmed for Telegram width). */
function chatLabel(agrNo: string, name: string | null): string {
  if (!name) return `№${agrNo}`;
  const short = name.length > 42 ? `${name.slice(0, 39)}…` : name;
  return `№${agrNo} ${short}`;
}

/**
 * Daily accounting analytics message, redesigned to lead with what Margarita
 * must ACT on — trend, coverage, who needs attention, which chats failed, who
 * is still waiting on a reply — before the full per-accountant roster. Backwards
 * compatible: the sheet metric labels and the per-accountant block are kept.
 */
export function buildReportMessage(
  report: DailyReport,
  options: ReportMessageOptions = {}
): string {
  const {
    totals,
    distribution,
    serviceQualityPct,
    coveragePct,
    perAccountant,
    needsAttention = [],
    criticalChats = [],
    tasks,
    filters,
  } = report;
  const { violations = [], sheetUrl, previous, maxList = 8 } = options;
  const dateISO =
    options.date ??
    filters.to ??
    filters.from ??
    new Date().toISOString().slice(0, 10);
  const lines: string[] = [];

  lines.push("📊 Аналитика качества бухгалтерии");
  lines.push(`🗓 ${periodHeader(report, dateISO)}`);
  if (filters.accountant) lines.push(`Бухгалтер: ${filters.accountant}`);
  lines.push("");

  // ── Headline: service %, trend, coverage ───────────────────────────────
  lines.push(`🏆 Сервис Бухгалтерии: ${serviceQualityPct}%${fmtTrend(serviceQualityPct, previous)}`);
  lines.push(
    `👁 Охват: оценено ${totals.evaluatedChats} из ${totals.activeChats} активных (${coveragePct}%)`
  );
  lines.push("");

  // ── Sheet metrics (kept) ───────────────────────────────────────────────
  lines.push(`Активных чатов: ${totals.activeChats}`);
  lines.push(`Новых чатов: ${totals.newChats}`);
  lines.push(`Чаты без ответственных: ${totals.chatsWithoutResponsible}`);
  lines.push(`Оценено чатов всего: ${totals.evaluatedChats}`);
  lines.push("");

  const evalCount = scoredCount(report);
  const lowShare =
    evalCount > 0
      ? Math.round(((distribution.Плохо + distribution.Критично) / evalCount) * 100)
      : 0;
  lines.push(
    `Отлично: ${distribution.Отлично} | Хорошо: ${distribution.Хорошо} | Плохо: ${distribution.Плохо} | Критично: ${distribution.Критично} (проблемных: ${lowShare}%)`
  );

  // ── 🚨 Требует внимания — the coaching to-do list (most urgent first) ────
  if (needsAttention.length) {
    lines.push("");
    lines.push(`🚨 Требует внимания (${needsAttention.length})`);
    for (const a of needsAttention.slice(0, maxList)) {
      const emoji = a.band ? BAND_EMOJI[a.band] : "🔴";
      lines.push(`${emoji} ${a.accountant} — ${a.reasons.join("; ")}`);
    }
    overflow(lines, needsAttention.length, maxList);
  }

  // ── ⛔️ Критичные чаты — what actually went wrong, openable per chat ──────
  if (criticalChats.length) {
    lines.push("");
    lines.push(`⛔️ Критичные чаты (${criticalChats.length})`);
    for (const c of criticalChats.slice(0, maxList)) {
      const who = c.accountant ? ` — ${c.accountant}` : "";
      const why = c.reasons.length ? `: ${c.reasons.join("; ")}` : ` (оценка ${c.score}%)`;
      lines.push(`• ${chatLabel(c.chat_agr_no, c.chat_name)}${who}${why}`);
    }
    overflow(lines, criticalChats.length, maxList);
  }

  // ── ⭐ Звёзды дня — perfect scorers (fallback: top scorer) ───────────────
  const scored = perAccountant.filter((a) => a.count > 0 && a.avgScore >= 0);
  const topScore = scored.reduce((m, a) => Math.max(m, a.avgScore), 0);
  const perfect = scored.filter((a) => a.avgScore === 100);
  const stars = perfect.length
    ? perfect
    : topScore > 0
      ? scored.filter((a) => a.avgScore === topScore)
      : [];
  if (stars.length) {
    lines.push("");
    lines.push("⭐ Звёзды дня");
    for (const a of stars)
      lines.push(`🌟 ${a.accountant} — ${a.avgScore}% (чатов: ${a.count})`);
  }

  // ── 🧮 Сервис Бухгалтерии — full roster, worst first so problems lead ────
  lines.push("");
  lines.push(`🧮 Сервис Бухгалтерии: ${serviceQualityPct}% (по бухгалтерам)`);
  if (scored.length === 0) {
    lines.push("— нет оценок за период —");
  }
  const roster = [...scored].sort((a, b) => a.avgScore - b.avgScore);
  for (const a of roster) {
    const emoji = BAND_EMOJI[bandFor(a.avgScore)];
    const low = a.lowCount > 0 ? `, низких: ${a.lowCount}` : "";
    lines.push(`${emoji} ${a.accountant} — ${a.avgScore}% (оценено: ${a.count}${low})`);
  }

  // ── ✅ Задачи Бухгалтерии (only when there are tasks) ────────────────────
  if (tasks.total > 0) {
    lines.push("");
    lines.push(
      `✅ Задачи Бухгалтерии: всего ${tasks.total} (в срок: ${tasks.onTime}, с опозданием: ${tasks.late}, просрочено: ${tasks.overdue})`
    );
    for (const a of tasks.perAccountant) {
      lines.push(
        `• ${a.accountant}: ${a.total} (в срок: ${a.onTime}, опозд.: ${a.late}, просроч.: ${a.overdue})`
      );
    }
  }

  // ── ⚠️ Нарушения — grouped per accountant, counted by severity ───────────
  const withAcc = violations.filter((v) => v.accountant);
  if (withAcc.length) {
    const byAcc = new Map<string, Map<string, number>>();
    for (const v of withAcc) {
      const acc = v.accountant as string;
      const sev = v.severity ?? "нарушение";
      const m = byAcc.get(acc) ?? new Map<string, number>();
      m.set(sev, (m.get(sev) ?? 0) + 1);
      byAcc.set(acc, m);
    }
    lines.push("");
    lines.push("⚠️ Нарушения");
    for (const [acc, sevs] of byAcc) {
      const parts = [...sevs.entries()]
        .map(([s, n]) => `${n} ${s.toLowerCase()}`)
        .join(", ");
      lines.push(`— ${acc}: ${parts}`);
    }
  }

  if (sheetUrl) {
    lines.push("");
    lines.push(`🔗 ${sheetUrl}`);
  }

  return lines.join("\n");
}

/** Append "    + ещё N" when a list was truncated to `shown`. */
function overflow(lines: string[], total: number, shown: number): void {
  if (total > shown) lines.push(`    + ещё ${total - shown}`);
}

/** How many evaluations the distribution covers (for the "problem share"). */
function scoredCount(report: DailyReport): number {
  const d = report.distribution;
  return d.Отлично + d.Хорошо + d.Плохо + d.Критично;
}

/**
 * A message addressed to ONE accountant, ready to copy and send them directly
 * (item 11 — Margarita copies a per-person message, not the whole roster). Leads
 * with their service %, then their critical chats with the concrete reason, then
 * their weaker chats. This is what she sends "сразу" per the boss's note.
 */
export function buildAccountantMessage(
  report: DailyReport,
  accountant: string,
  options: { date?: string } = {}
): string {
  const dateISO =
    options.date ??
    report.filters.to ??
    report.filters.from ??
    new Date().toISOString().slice(0, 10);
  const acc = report.perAccountant.find((a) => a.accountant === accountant);
  const crit = report.criticalChats.filter((c) => c.accountant === accountant);
  const waiting = (report.unansweredChats ?? []).filter(
    (c) => c.accountant === accountant
  );

  const lines: string[] = [];
  lines.push(`👤 ${accountant}`);
  lines.push(`🗓 ${fmtDay(dateISO)}`);
  if (acc && acc.count > 0 && acc.avgScore >= 0) {
    const emoji = BAND_EMOJI[bandFor(acc.avgScore)];
    lines.push(
      `${emoji} Сервис: ${acc.avgScore}% — ${bandFor(acc.avgScore)} (оценено чатов: ${acc.count})`
    );
  }

  if (crit.length) {
    lines.push("");
    lines.push(`⛔️ Критичные чаты (${crit.length}):`);
    for (const c of crit) {
      const why = c.reasons.length ? `: ${c.reasons.join("; ")}` : ` (оценка ${c.score}%)`;
      lines.push(`• ${chatLabel(c.chat_agr_no, c.chat_name)}${why}`);
    }
  } else if (acc && acc.lowCount > 0) {
    lines.push("");
    lines.push(`⚠️ Низких оценок за период: ${acc.lowCount} — нужно подтянуть качество.`);
  } else if (acc && acc.count > 0) {
    lines.push("");
    lines.push("✅ Критичных чатов нет — спасибо за работу!");
  }

  if (waiting.length) {
    lines.push("");
    lines.push(`⏳ Чаты без ответа (${waiting.length}):`);
    for (const w of waiting.slice(0, 10)) {
      const days =
        w.waitingDays != null && w.waitingDays > 0 ? ` · ждёт ${w.waitingDays} дн` : "";
      lines.push(`• ${chatLabel(w.chat_agr_no, w.chat_name)}${days}`);
    }
  }

  return lines.join("\n");
}

/**
 * Distinct accountants who have something worth sending (a critical chat, a low
 * average, or a chat still waiting on a reply) for the period — the people
 * Margarita should message, most urgent first.
 */
export function accountantsToMessage(report: DailyReport): string[] {
  const score = new Map<string, number>();
  const bump = (name: string | null, by: number) => {
    if (!name) return;
    score.set(name, (score.get(name) ?? 0) + by);
  };
  for (const c of report.criticalChats) bump(c.accountant, 100);
  for (const w of report.unansweredChats ?? []) bump(w.accountant, 10);
  for (const a of report.perAccountant) if (a.lowCount > 0) bump(a.accountant, a.lowCount);
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
}

/** Per-chat / per-accountant score message. */
export function buildScoreMessage(
  evaluation: Evaluation,
  chat: Chat | null
): string {
  const lines: string[] = [];
  const name = chat?.chat_name ?? evaluation.chat_agr_no;
  lines.push(`📝 Оценка чата: ${name} (№ ${evaluation.chat_agr_no})`);
  lines.push(`Дата проверки: ${evaluation.checking_date}`);
  lines.push(`Общая оценка: ${evaluation.total_score}% — ${evaluation.quality_band}`);
  if (evaluation.accountant) lines.push(`Ответственный: ${evaluation.accountant}`);

  const fails = failingMailings(evaluation.scores.monthly);
  if (fails.length) {
    lines.push(
      `⚠ Не выполнена рассылка: ${fails.map((f) => `${f.category} (${f.status})`).join(", ")}`
    );
  }

  const monthly = evaluation.scores.monthly;
  if (monthly) {
    const parts = MONTHLY_CATEGORIES.filter((c) => monthly[c.id]?.status).map(
      (c) => `${c.shortName}: ${monthly[c.id].status}`
    );
    if (parts.length) {
      lines.push("");
      lines.push(parts.join(" | "));
    }
  }

  if (evaluation.comment) {
    lines.push("");
    lines.push(`Комментарий: ${evaluation.comment}`);
  }
  if (chat?.chat_link) {
    lines.push("");
    lines.push(`Чат: ${chat.chat_link}`);
  }
  return lines.join("\n");
}

// --- Client survey invitation (from the "Чаты" AM / RU columns) ------------

const SURVEY_BASE = "https://onebusiness.typeform.com/to/otGeEHGj#client_id=";

export function surveyInviteRu(chat: Chat): string {
  return [
    "Для нашей команды очень важно поддерживать обратную связь с вами.",
    "",
    "Пожалуйста, уделите опросу всего 5 минут вашего времени",
    `${SURVEY_BASE}${chat.agr_no}`,
  ].join("\n");
}

export function surveyInviteAm(chat: Chat): string {
  return [
    "Թիմի համար շատ կարևոր է պահպանել հետադարձ կապը ձեզ հետ, խնդրում ենք հատկացնել հարցմանը ընդամենը 5 րոպե ձեր ժամանակից։",
    `${SURVEY_BASE}${chat.agr_no}`,
  ].join("\n");
}
