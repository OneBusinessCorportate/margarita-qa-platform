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
}

/**
 * Daily accounting report message, in Margarita's Telegram style:
 * header + дата + overall service + ⭐ stars of the day + a mark for EVERY
 * accountant + tasks + нарушения + link.
 */
export function buildReportMessage(
  report: DailyReport,
  options: ReportMessageOptions = {}
): string {
  const { totals, distribution, serviceQualityPct, perAccountant, tasks, filters } =
    report;
  const { violations = [], sheetUrl } = options;
  const dateISO =
    options.date ??
    filters.to ??
    filters.from ??
    new Date().toISOString().slice(0, 10);
  const lines: string[] = [];

  lines.push("📊 Ежедневный отчёт бухгалтерии");
  lines.push(`Дата: ${fmtDay(dateISO)}`);
  if (filters.accountant) lines.push(`Бухгалтер: ${filters.accountant}`);
  lines.push("");
  lines.push(`Общий уровень сервиса: ${serviceQualityPct}% по отделу`);
  lines.push("");

  // Chat metrics (kept from the sheet).
  lines.push(`Активных чатов: ${totals.activeChats}`);
  lines.push(`Новых чатов: ${totals.newChats}`);
  lines.push(`Чаты без ответственных: ${totals.chatsWithoutResponsible}`);
  lines.push(`Оценено чатов всего: ${totals.evaluatedChats}`);
  lines.push("");
  lines.push(
    `Отлично: ${distribution.Отлично} | Хорошо: ${distribution.Хорошо} | Плохо: ${distribution.Плохо} | Критично: ${distribution.Критично}`
  );

  // ⭐ Stars of the day — perfect scorers (fallback: the top scorer).
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
    lines.push("⭐ Звезда дня");
    for (const a of stars) lines.push(`🌟 ${a.accountant} — ${a.avgScore}%`);
  }

  // 🧮 Сервис Бухгалтерии — a mark for EVERY accountant (the "all people" part).
  lines.push("");
  lines.push(`🧮 Сервис Бухгалтерии: ${serviceQualityPct}%`);
  if (scored.length === 0) {
    lines.push("— нет оценок за период —");
  }
  for (const a of scored) {
    const emoji = BAND_EMOJI[bandFor(a.avgScore)];
    const low = a.lowCount > 0 ? `, низких: ${a.lowCount}` : "";
    lines.push(`${emoji} ${a.accountant} — ${a.avgScore}% (оценено: ${a.count}${low})`);
  }

  // ✅ Задачи Бухгалтерии.
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

  // ⚠️ Нарушения — grouped per accountant, counted by severity.
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
    lines.push(sheetUrl);
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
