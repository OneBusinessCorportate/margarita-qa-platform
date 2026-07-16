// Shared assembly for the report PDFs. Two shapes, matching the two Telegram
// messages so the PDF and the message always agree:
//   • "daily"  — a single day: the daily report + that day's confirmed
//     violations and per-accountant client-request counts (the «Кол-во
//     запросов за день» figures the daily message shows).
//   • "weekly" — the working week (Monday → the reported day): the day-by-day
//     grid + the week's violations.
// Used by the PDF download route and the Telegram send route.
import "server-only";

import {
  countClientRequests,
  getDailyAnalytics,
  getReport,
  listAccountants,
  listViolations,
} from "./repo";
import { mondayOf } from "./scoring";
import { dailyViolationRows } from "./violation-report";
import { addDays, type DailyReport } from "./report";
import type { Violation } from "./types";

export type ReportPeriod = "daily" | "weekly";

export interface AssembledPdfReport {
  report: DailyReport;
  /** The window the PDF covers. */
  resolved: { from: string; to: string };
  roster: string[];
  /** Violations for the window, for the PDF's «Нарушения» content. */
  violations: Violation[];
  /** Per-accountant client-request counts (daily «Кол-во запросов за день»). */
  requests: { accountant: string; count: number }[];
  /** Which shape to render. */
  mode: ReportPeriod;
  /**
   * Daily mode only: a multi-day report (last ~week ending at `to`) so the daily
   * PDF can render the all-accountants trend grid (динамика/прогресс). Undefined
   * for weekly mode, whose grid already shows day-by-day dynamics.
   */
  trend?: DailyReport;
}

export async function assemblePdfReport(
  from?: string,
  to?: string,
  period: ReportPeriod = "daily"
): Promise<AssembledPdfReport> {
  const { report, resolved } = await getDailyAnalytics({ from, to });

  if (period === "weekly") {
    // Widen a single day to its working week (Mon → that day) so the grid shows
    // day-by-day columns like the monitoring sheet.
    let gridReport = report;
    let gridFrom = resolved.from;
    if (resolved.from === resolved.to) {
      const monday = mondayOf(resolved.to);
      if (monday !== resolved.to) {
        gridReport = await getReport({ from: monday, to: resolved.to });
        gridFrom = monday;
      }
    }
    const [accountants, violations] = await Promise.all([
      listAccountants(),
      listViolations({ from: gridFrom, to: resolved.to }),
    ]);
    const roster = accountants
      .filter((a) => a.active && a.role === "accountant")
      .map((a) => a.name);
    return {
      report: gridReport,
      resolved: { from: gridFrom, to: resolved.to },
      roster,
      violations,
      requests: [],
      mode: "weekly",
    };
  }

  // Daily: strictly the reported day — matches the daily Telegram message.
  const [accountants, dayViolationsRaw, requests] = await Promise.all([
    listAccountants(),
    listViolations({ from: resolved.from, to: resolved.to }),
    countClientRequests(resolved.from, resolved.to),
  ]);
  const roster = accountants
    .filter((a) => a.active && a.role === "accountant")
    .map((a) => a.name);
  // Only Margarita's confirmed violations reach the daily report, collapsed to
  // one row per нарушение — the same source the daily message uses.
  const confirmed = dayViolationsRaw.filter((v) => v.confirmed !== false);
  const { violations } = dailyViolationRows(confirmed);

  // Trend window for the all-accountants dynamics grid: the ~week ending at the
  // reported day. When the report already spans that window (a range request in
  // daily mode) it has the per-day data, so reuse it instead of re-fetching.
  const trendFrom = addDays(resolved.to, -6);
  const trend =
    trendFrom < resolved.from
      ? await getReport({ from: trendFrom, to: resolved.to })
      : report;

  return {
    report,
    resolved: { from: resolved.from, to: resolved.to },
    roster,
    violations,
    requests,
    mode: "daily",
    trend,
  };
}
