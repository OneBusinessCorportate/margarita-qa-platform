// ---------------------------------------------------------------------------
// Live per-accountant violation breakdown for Margarita's dashboard.
//
// Единственный источник — ЖИВАЯ таблица mqa_violations (то, что Маргарита
// внесла и подтвердила сама). НИКАКОГО ИИ и никаких статических Excel-выгрузок.
// Суммы считаются одним и тем же движком groupNarusheniya (violations.ts):
//   • 1-е нарушение за день → предупреждение (0 др);
//   • каждое следующее за тот же день → штраф 1 000 др;
//   • ручная санкция Маргариты (> 0) — подтверждённый штраф, перебивает правило.
// Тяжесть (Среднее/Критичное/Грубое) — только флаг, суммы не выставляет.
// ---------------------------------------------------------------------------
import type { Violation } from "./types";
import { groupNarusheniya, type FineViolation } from "./violations";
import { canonicalShortName, findEmployee } from "./valid-employees";

export interface ViolationLine {
  date: string | null;
  chatCode: string | null;
  client: string | null;
  type: string | null;
  severity: string | null;
  gross: boolean;
  critical: boolean;
  /** «warning» (предупреждение, 0 др) или «penalty» (штраф, > 0). */
  kind: "warning" | "penalty";
  amount: number;
  note: string | null;
  confirmed: boolean;
  appealStatus: string | null; // null | 'appealed' | 'approved' | 'rejected'
}

export interface AccountantViolations {
  employee: string;
  employeeFull: string;
  lines: ViolationLine[];
  count: number; // нарушений (чатов), не строк
  warnings: number; // сколько предупреждений
  penalties: number; // сколько штрафов
  total: number; // сумма штрафов, др
}

export interface ViolationReportSummary {
  violations: number; // всего нарушений (чатов)
  warnings: number;
  penalties: number;
  critical: number; // сколько с флагом «Критичное»
  appealed: number; // сколько под апелляцией
  fineTotal: number; // сумма штрафов, др
}

export interface ViolationReport {
  perAccountant: AccountantViolations[];
  summary: ViolationReportSummary;
}

const isCritical = (sev: string | null | undefined) => /критич/i.test(sev ?? "");

/** Map a live Violation row to the fine-engine input. */
function toFineInput(v: Violation): FineViolation {
  return {
    vdate: (v.vdate ?? "").slice(0, 10),
    accountant: canonicalShortName(v.accountant) ?? v.accountant ?? "",
    severity: v.gross ? "Грубое" : v.severity,
    sanction: v.sanction,
    chat_agr_no: v.chat_agr_no,
    client: v.client,
    violation_type: v.gross || v.violation_type,
  };
}

/**
 * One synthetic Violation row PER нарушение (chat collapsed, warning/penalty
 * priced) for the daily Telegram report — the LIVE replacement of the old
 * static `auditDailyViolations`. `fineById[row.id]` carries the нарушение's fine
 * so buildReportMessage renders «предупреждение» (0) vs the штраф consistently.
 */
export function dailyViolationRows(
  violations: Violation[]
): { violations: Violation[]; fineById: Record<string, number> } {
  const narusheniya = groupNarusheniya(violations.map(toFineInput));
  const rows: Violation[] = [];
  const fineById: Record<string, number> = {};
  for (const n of narusheniya) {
    const rep = violations[n.rowIndexes[0]];
    if (!rep) continue;
    fineById[rep.id] = n.fine;
    rows.push({
      ...rep,
      severity: n.severity,
      violation_type: n.types.join(", ") || rep.violation_type,
    });
  }
  return { violations: rows, fineById };
}

/**
 * Build the per-accountant breakdown + summary from live violation rows.
 * `roster` (optional) seeds accountants with zero violations so the dashboard
 * can show the whole team, not only those who slipped.
 */
export function buildLiveViolationBreakdown(
  violations: Violation[],
  roster: string[] = []
): ViolationReport {
  // Keep the ORIGINAL row alongside each fine-input so we can carry note /
  // confirmed / appeal flags onto the grouped нарушение (the representative row).
  const fineInput: FineViolation[] = violations.map((v) => ({
    vdate: (v.vdate ?? "").slice(0, 10),
    accountant: canonicalShortName(v.accountant) ?? v.accountant ?? "",
    severity: v.gross ? "Грубое" : v.severity,
    sanction: v.sanction,
    chat_agr_no: v.chat_agr_no,
    client: v.client,
    violation_type: v.gross || v.violation_type,
  }));

  const perAcc = new Map<string, AccountantViolations>();
  const seed = (name: string) => {
    if (perAcc.has(name)) return;
    const emp = findEmployee(name);
    perAcc.set(name, {
      employee: emp?.short ?? name,
      employeeFull: emp?.canonical ?? name,
      lines: [],
      count: 0,
      warnings: 0,
      penalties: 0,
      total: 0,
    });
  };
  for (const r of roster) if (r) seed(canonicalShortName(r) ?? r);

  const summary: ViolationReportSummary = {
    violations: 0,
    warnings: 0,
    penalties: 0,
    critical: 0,
    appealed: 0,
    fineTotal: 0,
  };

  for (const n of groupNarusheniya(fineInput)) {
    const key = n.accountant || "— Не назначено —";
    seed(key);
    const g = perAcc.get(key)!;
    // Representative row = the earliest problem in this нарушение; carry its
    // note / confirmed / appeal flags (Margarita's own data).
    const rep = violations[n.rowIndexes[0]];
    const critical = isCritical(n.severity);
    const line: ViolationLine = {
      date: n.vdate || null,
      chatCode: n.chat_agr_no,
      client: n.client,
      type: n.types.join(", ") || null,
      severity: n.severity,
      gross: n.klass === "gross",
      critical,
      kind: n.kind,
      amount: n.fine,
      note: rep?.note ?? null,
      confirmed: rep?.confirmed ?? true,
      appealStatus: rep?.appeal_status ?? null,
    };
    g.lines.push(line);
    g.count += 1;
    g.total += n.fine;
    if (n.kind === "penalty") g.penalties += 1;
    else g.warnings += 1;

    summary.violations += 1;
    summary.fineTotal += n.fine;
    if (n.kind === "penalty") summary.penalties += 1;
    else summary.warnings += 1;
    if (critical) summary.critical += 1;
    if (line.appealStatus === "appealed") summary.appealed += 1;
  }

  for (const g of perAcc.values())
    g.lines.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  const perAccountant = [...perAcc.values()].sort(
    (a, b) => b.total - a.total || b.count - a.count || a.employee.localeCompare(b.employee)
  );
  return { perAccountant, summary };
}
