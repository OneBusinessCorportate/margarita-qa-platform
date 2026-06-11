// ---------------------------------------------------------------------------
// Telegram message templates. v1 is COPY-TO-CLIPBOARD ONLY — no bot send.
// Keep all wording here so it is trivial to edit in one place.
//
// TODO(margarita): confirm exact wording/format of the report + per-chat
// messages. Templates below mirror the sheet's metrics as placeholders.
//
// A future "Send via bot" path can call a sendToTelegram(text) helper guarded
// by TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID (see telegramConfigured()).
// ---------------------------------------------------------------------------

import type { DailyReport } from "./report";
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

/** Daily report message: totals + distribution + per-accountant lines. */
export function buildReportMessage(report: DailyReport): string {
  const { totals, distribution, serviceQualityPct, perAccountant, filters } =
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
  lines.push(
    `Отлично: ${distribution.Отлично} | Хорошо: ${distribution.Хорошо} | Плохо: ${distribution.Плохо} | Критично: ${distribution.Критично}`
  );
  lines.push("");
  lines.push(`Сервис Бухгалтерии: ${serviceQualityPct}%`);

  if (perAccountant.length) {
    lines.push("");
    lines.push("По бухгалтерам:");
    for (const a of perAccountant) {
      lines.push(
        `• ${a.accountant}: ${a.avgScore}% (оценено: ${a.count}, низких: ${a.lowCount})`
      );
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
  lines.push(`Оценка: ${evaluation.total_score}% — ${evaluation.quality_band}`);
  if (evaluation.accountant) lines.push(`Ответственный: ${evaluation.accountant}`);
  if (chat?.manager) lines.push(`Менеджер: ${chat.manager}`);
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
