// Pure aggregation for Margarita's work report (DB-free, unit-tested). The
// route/page fetches the rows (evaluations she recorded, violations/issues she
// raised, and the appeals accountants filed) and passes them here.
//
// Naming caveat: evaluations/violations carry Margarita's short accountant
// names, while appeals/issues (ingested into the accountant app) carry resolved
// full names. We key the per-accountant breakdown by a normalized name and let
// unmatched spellings appear as their own row rather than guess a merge.

import { normalizeName } from "./valid-employees";
import { groupNarusheniya } from "./violations";

export interface AppealLike {
  accountant_name?: string | null;
  status: string; // pending | approved | rejected
  created_at: string;
  problem_id?: string;
}

export interface EvaluationLike {
  chat_agr_no: string;
  accountant?: string | null;
  checking_date: string;
}

export interface ViolationLike {
  accountant?: string | null;
  vdate: string;
  severity?: string | null;
  sanction?: number | null;
  gross?: string | null;
  chat_agr_no?: string | null;
  client?: string | null;
  violation_type?: string | null;
}

export interface IssueLike {
  accountant_name?: string | null;
  detected_at?: string | null;
}

export interface AppealSummary {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
}

export interface WorkReportRow {
  name: string;
  chatsChecked: number;
  issues: number;
  violations: number; // нарушений (чатов), одинаково с дашбордом
  warnings: number; // предупреждений (0 др)
  penalties: number; // штрафов (> 0 др)
  fineTotal: number; // сумма штрафов, др
  appeals: number;
  approved: number;
  rejected: number;
  pending: number;
}

export interface WorkReportDay {
  date: string;
  chatsChecked: number;
  issues: number;
  violations: number;
  warnings: number;
  penalties: number;
  appeals: number;
}

export interface WorkReport {
  chatsChecked: number;
  evaluations: number;
  issuesCreated: number;
  violations: number; // всего нарушений (чатов)
  warnings: number; // всего предупреждений
  penalties: number; // всего штрафов
  fineTotal: number; // сумма штрафов, др
  appeals: AppealSummary;
  byAccountant: WorkReportRow[];
  byDate: WorkReportDay[];
}

export function summarizeAppeals(appeals: AppealLike[] = []): AppealSummary {
  return {
    total: appeals.length,
    pending: appeals.filter((a) => a.status === "pending").length,
    approved: appeals.filter((a) => a.status === "approved").length,
    rejected: appeals.filter((a) => a.status === "rejected").length,
  };
}

function day(value: string | null | undefined): string | null {
  if (!value) return null;
  return String(value).slice(0, 10);
}

export function buildWorkReport({
  evaluations = [],
  violations = [],
  issues = [],
  appeals = [],
}: {
  evaluations?: EvaluationLike[];
  violations?: ViolationLike[];
  issues?: IssueLike[];
  appeals?: AppealLike[];
} = {}): WorkReport {
  const chatSet = new Set(evaluations.map((e) => e.chat_agr_no).filter(Boolean));

  // ---- per accountant --------------------------------------------------
  const rows = new Map<
    string,
    WorkReportRow & { _chats: Set<string> }
  >();
  const rowFor = (name: string | null | undefined) => {
    const key = normalizeName(name) || "—";
    if (!rows.has(key)) {
      rows.set(key, {
        name: (name || "").trim() || "— Не назначено —",
        chatsChecked: 0,
        issues: 0,
        violations: 0,
        warnings: 0,
        penalties: 0,
        fineTotal: 0,
        appeals: 0,
        approved: 0,
        rejected: 0,
        pending: 0,
        _chats: new Set(),
      });
    }
    return rows.get(key)!;
  };

  for (const e of evaluations) {
    const r = rowFor(e.accountant);
    if (e.chat_agr_no) r._chats.add(e.chat_agr_no);
  }
  // Нарушения → предупреждение/штраф по ЕДИНОМУ движку (violations.ts), как на
  // дашборде: 1-е за день — предупреждение (0 др), повторное — 1 000 др, ручная
  // санкция перебивает. Так counts здесь и на дашборде всегда совпадают.
  const narusheniya = groupNarusheniya(
    violations.map((v) => ({
      vdate: (v.vdate || "").slice(0, 10),
      accountant: v.accountant ?? "",
      severity: v.gross ? "Грубое" : v.severity ?? null,
      sanction: v.sanction ?? null,
      chat_agr_no: v.chat_agr_no ?? null,
      client: v.client ?? null,
      violation_type: v.gross || v.violation_type || null,
    }))
  );
  let totWarnings = 0;
  let totPenalties = 0;
  let totFine = 0;
  for (const n of narusheniya) {
    const r = rowFor(n.accountant);
    r.violations += 1;
    r.fineTotal += n.fine;
    if (n.kind === "penalty") {
      r.penalties += 1;
      totPenalties += 1;
    } else {
      r.warnings += 1;
      totWarnings += 1;
    }
    totFine += n.fine;
  }
  for (const i of issues) rowFor(i.accountant_name).issues += 1;
  for (const a of appeals) {
    const r = rowFor(a.accountant_name);
    r.appeals += 1;
    if (a.status === "approved") r.approved += 1;
    else if (a.status === "rejected") r.rejected += 1;
    else r.pending += 1;
  }

  const byAccountant: WorkReportRow[] = [...rows.values()]
    .map(({ _chats, ...r }) => ({ ...r, chatsChecked: _chats.size }))
    .sort(
      (a, b) =>
        b.chatsChecked + b.issues + b.violations + b.appeals -
        (a.chatsChecked + a.issues + a.violations + a.appeals)
    );

  // ---- per day ---------------------------------------------------------
  const days = new Map<string, WorkReportDay & { _chats: Set<string> }>();
  const dayFor = (d: string) => {
    if (!days.has(d))
      days.set(d, {
        date: d,
        chatsChecked: 0,
        issues: 0,
        violations: 0,
        warnings: 0,
        penalties: 0,
        appeals: 0,
        _chats: new Set(),
      });
    return days.get(d)!;
  };
  for (const e of evaluations) {
    const d = day(e.checking_date);
    if (d && e.chat_agr_no) dayFor(d)._chats.add(e.chat_agr_no);
  }
  for (const n of narusheniya) {
    const d = day(n.vdate);
    if (!d) continue;
    const dd = dayFor(d);
    dd.violations += 1;
    if (n.kind === "penalty") dd.penalties += 1;
    else dd.warnings += 1;
  }
  for (const i of issues) {
    const d = day(i.detected_at);
    if (d) dayFor(d).issues += 1;
  }
  for (const a of appeals) {
    const d = day(a.created_at);
    if (d) dayFor(d).appeals += 1;
  }
  const byDate: WorkReportDay[] = [...days.values()]
    .map(({ _chats, ...d }) => ({ ...d, chatsChecked: _chats.size }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  return {
    chatsChecked: chatSet.size,
    evaluations: evaluations.length,
    issuesCreated: issues.length,
    violations: narusheniya.length, // нарушений (чатов), совпадает с дашбордом
    warnings: totWarnings,
    penalties: totPenalties,
    fineTotal: totFine,
    appeals: summarizeAppeals(appeals),
    byAccountant,
    byDate,
  };
}
