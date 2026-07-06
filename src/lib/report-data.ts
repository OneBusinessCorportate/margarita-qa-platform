// Shared assembly for the PDF report grid: resolves the window, widens a
// single day to its working week (Monday → that day) so the grid shows day
// columns like the monitoring spreadsheet, and loads the canonical roster.
// Used by the PDF download route and the Telegram send route.
import "server-only";

import { getDailyAnalytics, getReport, listAccountants } from "./repo";
import { mondayOf } from "./scoring";
import type { DailyReport } from "./report";

export interface AssembledPdfReport {
  report: DailyReport;
  /** The window the grid covers (may be wider than the requested day). */
  resolved: { from: string; to: string };
  roster: string[];
}

export async function assemblePdfReport(
  from?: string,
  to?: string
): Promise<AssembledPdfReport> {
  const { report, resolved } = await getDailyAnalytics({ from, to });

  // A single-day request still renders the week-so-far grid (Mon → that day),
  // matching the monitoring sheet's day-by-day columns.
  let gridReport = report;
  let gridFrom = resolved.from;
  if (resolved.from === resolved.to) {
    const monday = mondayOf(resolved.to);
    if (monday !== resolved.to) {
      gridReport = await getReport({ from: monday, to: resolved.to });
      gridFrom = monday;
    }
  }

  const accountants = await listAccountants();
  const roster = accountants
    .filter((a) => a.active && a.role === "accountant")
    .map((a) => a.name);

  return { report: gridReport, resolved: { from: gridFrom, to: resolved.to }, roster };
}
