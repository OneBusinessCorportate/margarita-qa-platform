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
import { MONTHLY_CATEGORIES } from "./scoring";
import type { Chat, Evaluation } from "./types";

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

/** Daily report message: totals + distribution + per-accountant + tasks. */
export function buildReportMessage(report: DailyReport): string {
  const { totals, distribution, serviceQualityPct, perAccountant, tasks, filters } =
    report;
  const lines: string[] = [];

  lines.push(`📊 Отчёт по качеству чатов — ${fmtDateRange(filters.from, filters.to)}`);
  if (filters.accountant) lines.push(`Бухгалтер: ${filters.accountant}`);
  lines.push("");
  lines.push(`Активных чатов: ${totals.activeChats}`);
  lines.push(`Новых чатов: ${totals.newChats}`);
  lines.push(`Чаты без ответственных: ${totals.chatsWithoutResponsible}`);
  lines.push(`Оценено чатов всего: ${totals.evaluatedChats}`);
  lines.push("");
  lines.push(`Отлично: ${distribution.Отлично} | Хорошо: ${distribution.Хорошо} | Плохо: ${distribution.Плохо} | Критично: ${distribution.Критично}`);
  lines.push("");
  lines.push(`🧮 Сервис Бухгалтерии: ${serviceQualityPct}%`);
  for (const a of perAccountant) {
    const score = a.avgScore < 0 ? "—" : `${a.avgScore}%`;
    lines.push(`• ${a.accountant}: ${score} (оценено: ${a.count}, низких: ${a.lowCount})`);
  }

  if (tasks.total > 0) {
    lines.push("");
    lines.push(`✅ Задачи Бухгалтерии: всего ${tasks.total} (в срок: ${tasks.onTime}, с опозданием: ${tasks.late}, просрочено: ${tasks.overdue})`);
    for (const a of tasks.perAccountant) {
      lines.push(`• ${a.accountant}: ${a.total} (в срок: ${a.onTime}, опозд.: ${a.late}, просроч.: ${a.overdue})`);
    }
  }

  return lines.join("\n");
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
