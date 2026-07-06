// Shared assembly for the analytics report + PDF: one place that gathers the
// report, its trend baseline, violations, request counts and the canonical
// roster for a date window. Used by the PDF download route and the Telegram
// send route so both always agree with the /messages page.
import "server-only";

import {
  countClientRequests,
  getDailyAnalytics,
  listAccountants,
  listViolations,
} from "./repo";
import type { DailyReport } from "./report";
import type { Violation } from "./types";

export interface AssembledReport {
  report: DailyReport;
  previous: DailyReport | null;
  resolved: { from: string; to: string };
  violations: Violation[];
  roster: string[];
  requests: { accountant: string; count: number }[];
  requestDays: number;
}

export async function assembleReport(
  from?: string,
  to?: string
): Promise<AssembledReport> {
  const { report, previous, resolved } = await getDailyAnalytics({ from, to });
  const [violations, accountants, requests] = await Promise.all([
    listViolations({ from: resolved.from, to: resolved.to }),
    listAccountants(),
    countClientRequests(resolved.from, resolved.to),
  ]);
  const roster = accountants
    .filter((a) => a.active && a.role === "accountant")
    .map((a) => a.name);
  const dayMs = 24 * 60 * 60 * 1000;
  const requestDays =
    Math.round(
      (new Date(resolved.to + "T00:00:00Z").getTime() -
        new Date(resolved.from + "T00:00:00Z").getTime()) /
        dayMs
    ) + 1;
  return { report, previous, resolved, violations, roster, requests, requestDays };
}
