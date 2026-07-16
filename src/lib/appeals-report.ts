// Pure aggregation for the violation → acknowledge / appeal → decision loop
// (Phase 4/5/6). DB-free and unit-tested; the /work-report page, the /dashboard
// tiles and the Telegram daily report ALL call buildViolationWorkflowReport so
// there is exactly ONE definition of every metric (no per-component formulas).
//
// Counting unit: the violation RECORD (not chat-collapsed нарушения), because
// acknowledgement and appeals operate per record. This is the workLOAD report;
// the money/fine report (work-report.ts / violation-report.ts) keeps using the
// chat-collapsing fine engine and is unaffected.

import { normalizeName, findEmployee } from "./valid-employees";
import { violationStatus } from "./violation-workflow";
import type { Violation, ViolationAppeal, ViolationStatus } from "./types";

export interface WorkflowEvaluationLike {
  chat_agr_no: string;
  accountant?: string | null;
  checking_date: string;
}

/** Safe percentage: 0 when the denominator is 0 (never divide-by-zero). */
export function pct(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10; // one decimal
}

export interface WorkflowAccountantRow {
  name: string;
  chatsChecked: number;
  evaluations: number;
  violations: number;
  acknowledgements: number;
  appealsSubmitted: number;
  approved: number;
  rejected: number;
  pending: number;
  /** Violations still awaiting an accountant reaction (status `new`). */
  unprocessed: number;
}

export interface ViolationWorkflowReport {
  chatsChecked: number;
  evaluations: number;
  violationsCreated: number;
  accountantsWithViolations: number;
  acknowledged: number;
  appealsSubmitted: number;
  appealsPending: number;
  appealsApproved: number;
  appealsRejected: number;
  /** approved + rejected. */
  appealsProcessed: number;
  /** = appealsPending. */
  unresolvedAppeals: number;
  /** Violations with status `new` (accountant has not reacted). */
  unprocessedViolations: number;
  /** Penalties cancelled because their appeal was approved. */
  penaltiesCancelled: number;
  /** processed / submitted × 100 (0 when none submitted). */
  appealProcessingPct: number;
  /** processed-by-accountant / created × 100 (acknowledged or appealed). */
  acknowledgementPct: number;
  byAccountant: WorkflowAccountantRow[];
}

const PROCESSED_BY_ACCOUNTANT: ViolationStatus[] = [
  "acknowledged",
  "appealed",
  "appeal_approved",
  "appeal_rejected",
];

/**
 * Build the workflow report from stored records. Only Margarita's confirmed
 * violations count (confirmed !== false) — auto/legacy rows are ignored, exactly
 * like the dashboard and the fine report. Per-accountant rows merge name aliases
 * (short Armenian from violations/evaluations vs full names from appeals) the
 * same way work-report.ts does.
 */
export function buildViolationWorkflowReport({
  evaluations = [],
  violations = [],
  appeals = [],
}: {
  evaluations?: WorkflowEvaluationLike[];
  violations?: Violation[];
  appeals?: ViolationAppeal[];
} = {}): ViolationWorkflowReport {
  const confirmed = violations.filter((v) => v.confirmed !== false);

  // Index appeals by violation so a violation's own accountant/status drives the
  // per-accountant row (appeals carry the same short names as violations here).
  const rows = new Map<string, WorkflowAccountantRow & { _chats: Set<string> }>();
  const rowFor = (name: string | null | undefined) => {
    const emp = findEmployee(name);
    const key = emp ? emp.short : normalizeName(name) || "—";
    if (!rows.has(key)) {
      rows.set(key, {
        name: emp ? emp.canonical : (name || "").trim() || "— Не назначено —",
        chatsChecked: 0,
        evaluations: 0,
        violations: 0,
        acknowledgements: 0,
        appealsSubmitted: 0,
        approved: 0,
        rejected: 0,
        pending: 0,
        unprocessed: 0,
        _chats: new Set(),
      });
    }
    return rows.get(key)!;
  };

  const chatSet = new Set<string>();
  for (const e of evaluations) {
    const r = rowFor(e.accountant);
    r.evaluations += 1;
    if (e.chat_agr_no) {
      r._chats.add(e.chat_agr_no);
      chatSet.add(e.chat_agr_no);
    }
  }

  let acknowledged = 0;
  let unprocessedViolations = 0;
  let penaltiesCancelled = 0;
  const accountantsWithViolations = new Set<string>();
  for (const v of confirmed) {
    const r = rowFor(v.accountant);
    r.violations += 1;
    if (v.accountant) accountantsWithViolations.add(normalizeName(v.accountant));
    const status = violationStatus(v);
    if (status === "acknowledged") {
      acknowledged += 1;
      r.acknowledgements += 1;
    } else if (status === "new") {
      unprocessedViolations += 1;
      r.unprocessed += 1;
    } else if (status === "appeal_approved") {
      penaltiesCancelled += 1;
    }
  }

  let appealsPending = 0;
  let appealsApproved = 0;
  let appealsRejected = 0;
  for (const a of appeals) {
    const r = rowFor(a.accountant);
    r.appealsSubmitted += 1;
    if (a.status === "approved") {
      appealsApproved += 1;
      r.approved += 1;
    } else if (a.status === "rejected") {
      appealsRejected += 1;
      r.rejected += 1;
    } else {
      appealsPending += 1;
      r.pending += 1;
    }
  }

  const byAccountant = [...rows.values()]
    .map(({ _chats, ...r }) => ({ ...r, chatsChecked: _chats.size }))
    .filter(
      (r) =>
        r.chatsChecked + r.evaluations + r.violations + r.appealsSubmitted > 0
    )
    .sort(
      (a, b) =>
        b.violations + b.appealsSubmitted - (a.violations + a.appealsSubmitted) ||
        b.chatsChecked - a.chatsChecked ||
        a.name.localeCompare(b.name)
    );

  const appealsSubmitted = appeals.length;
  const appealsProcessed = appealsApproved + appealsRejected;
  const violationsCreated = confirmed.length;
  const processedByAccountant = confirmed.filter((v) =>
    PROCESSED_BY_ACCOUNTANT.includes(violationStatus(v))
  ).length;

  return {
    chatsChecked: chatSet.size,
    evaluations: evaluations.length,
    violationsCreated,
    accountantsWithViolations: accountantsWithViolations.size,
    acknowledged,
    appealsSubmitted,
    appealsPending,
    appealsApproved,
    appealsRejected,
    appealsProcessed,
    unresolvedAppeals: appealsPending,
    unprocessedViolations,
    penaltiesCancelled,
    appealProcessingPct: pct(appealsProcessed, appealsSubmitted),
    acknowledgementPct: pct(processedByAccountant, violationsCreated),
    byAccountant,
  };
}
