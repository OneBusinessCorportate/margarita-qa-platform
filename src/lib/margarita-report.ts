// Shared assembler for the daily «Апелляции и QA Маргариты» Telegram report.
//
// DB access (via repo.ts) and message rendering (via templates.ts) live here so
// there is ONE definition of the report used by BOTH:
//   • the manual API route  /api/telegram/margarita-report  (session-protected,
//     for "send it now to verify"), and
//   • the daily cron script scripts/send-margarita-report.ts (runs outside Next,
//     so this file must NOT import "server-only").
//
// Only Margarita's own QA data is used — the same aggregation
// (buildViolationWorkflowReport) as /work-report and /dashboard. No AI, no
// static Excel exports.

import { getViolationWorkflowReport, getReport } from "./repo";
import { buildMargaritaWorkReportMessage } from "./templates";
import type { ViolationWorkflowReport } from "./appeals-report";

/**
 * Env var for a SEPARATE Telegram chat dedicated to Margarita's QA/appeals
 * report. OPTIONAL — set it only when the report should go somewhere other than
 * the shared TELEGRAM_CHAT_ID.
 */
export const MARGARITA_QA_CHAT_ENV = "MARGARITA_QA_TELEGRAM_CHAT_ID";

/**
 * Pick the chat id for the Margarita QA/appeals report. Prefers the dedicated
 * MARGARITA_QA_TELEGRAM_CHAT_ID; otherwise falls back to the shared
 * TELEGRAM_CHAT_ID, so no NEW env var is required — add the dedicated one only
 * if a separate chat is wanted. Returns undefined when neither is set.
 */
export function pickMargaritaChatId(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): string | undefined {
  const dedicated = env[MARGARITA_QA_CHAT_ENV]?.trim();
  if (dedicated) return dedicated;
  const shared = env.TELEGRAM_CHAT_ID?.trim();
  return shared || undefined;
}

/** Whether the bot can send the Margarita report (token + some chat id set). */
export function margaritaReportConfigured(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN && pickMargaritaChatId(env));
}

/** Today's date (YYYY-MM-DD) in the Yerevan timezone — the report's business day. */
export function yerevanToday(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Yerevan",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export interface MargaritaReportWindow {
  from: string;
  to: string;
  accountant?: string;
}

export interface MargaritaWindowOptions {
  /** Single day (YYYY-MM-DD). Ignored when `from`/`to` are given. */
  date?: string;
  from?: string;
  to?: string;
  /** Optional per-accountant scope (canonical short name). */
  accountant?: string;
}

/**
 * Resolve the report window from optional overrides. Defaults to TODAY (Yerevan)
 * for the daily report; a single `date` or an explicit `from`/`to` range both
 * work (a lone `from` or `to` collapses to that single day).
 */
export function resolveMargaritaWindow(opts: MargaritaWindowOptions = {}): MargaritaReportWindow {
  const today = yerevanToday();
  if (opts.from || opts.to) {
    const from = opts.from ?? opts.to ?? today;
    const to = opts.to ?? opts.from ?? today;
    return { from, to, accountant: opts.accountant };
  }
  const day = opts.date ?? today;
  return { from: day, to: day, accountant: opts.accountant };
}

export interface AssembledMargaritaReport {
  window: MargaritaReportWindow;
  report: ViolationWorkflowReport;
  message: string;
}

/**
 * Load Margarita's QA + appeals workflow data for the window and render the
 * Telegram message. THROWS on a data-load failure — callers MUST NOT fall back
 * to sending an all-zero message (a load error has to read differently from a
 * genuinely quiet day). buildMargaritaWorkReportMessage already spells out a
 * quiet day explicitly.
 */
export async function assembleMargaritaReport(
  opts: MargaritaWindowOptions = {}
): Promise<AssembledMargaritaReport> {
  const window = resolveMargaritaWindow(opts);
  // Three loads, same accountant scope:
  //   • report      — метрики ЗА ДЕНЬ (проверено/создано/подано + реакции дня).
  //   • dailyReport — «активных чатов» (totals.activeChats), тот же расчёт
  //     активности, что дашборд/отчёт, поэтому «N из M» всегда совпадает.
  //   • backlog     — ВЕСЬ непогашенный бэклог (без окна дат) для строк-алертов
  //     «!!! без реакции»: реальная очередь на действие, а не срез за день.
  const [report, dailyReport, backlog] = await Promise.all([
    getViolationWorkflowReport(window),
    getReport({ from: window.from, to: window.to, accountant: window.accountant }),
    getViolationWorkflowReport({ accountant: window.accountant }),
  ]);
  const message = buildMargaritaWorkReportMessage(report, {
    date: window.to,
    activeChats: dailyReport.totals.activeChats,
    unprocessedBacklog: backlog.unprocessedViolations,
    pendingBacklog: backlog.appealsPending,
  });
  return { window, report, message };
}
