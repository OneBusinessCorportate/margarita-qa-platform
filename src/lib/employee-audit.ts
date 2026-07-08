// ---------------------------------------------------------------------------
// Аудит сотрудников: единая пересчитанная картина по 14 действующим бухгалтерам.
//
// Всё считается ТОЛЬКО по данным из приложенных файлов (audit-source-data.ts) и
// фильтруется через утверждённый список (valid-employees.ts). Невалидные,
// уволенные, дублирующиеся и ошибочно записанные имена в расчёты НЕ попадают —
// они отдельно перечислены как «Невалидные имена». Неоднозначные имена уходят
// в «Требует ручной проверки», а не приклеиваются к похожему сотруднику.
//
// Штрафы (санкции) и бонусы берутся из листа «KPI и результаты» — единственного
// места, где заполнены суммы. В листе «Нарушения» колонка «Санкция в драм.»
// пустая, поэтому суммировать нарушения как деньги нельзя (это и была прежняя
// ошибка). Нарушения показываем как журнал, деньги — из KPI.
// ---------------------------------------------------------------------------

import { AUDIT_SOURCE, type RawViolation } from "./audit-source-data";
import {
  VALID_EMPLOYEES,
  resolveEmployee,
  canonicalShortName,
  type ValidEmployee,
} from "./valid-employees";

/** Один пересчитанный элемент нарушения (для раздела D). */
export interface AuditViolation {
  date: string | null;
  employee: string; // каноническое короткое имя валидного сотрудника
  employeeFull: string;
  client: string | null;
  severity: string | null;
  type: string | null; // сервисное или грубое нарушение
  gross: boolean;
  source: string; // файл/лист-источник
  explanation: string | null;
  sanction: number | null; // если проставлена в источнике
  confirmed: boolean; // подтверждено (есть решение/апелляция закрыта) или на проверке
}

/** Санкция/бонус из листа KPI (раздел E). */
export interface MoneyItem {
  employee: string;
  employeeFull: string;
  month: string;
  amount: number | null; // драм (для санкций) — у бонусов часто «% от оклада»
  text: string | null; // исходный текст бонуса
}

/** Строка сравнения по источникам (раздел F). */
export interface SourceRow {
  employee: string; // каноническое короткое имя
  employeeFull: string;
  inList: boolean; // утверждённый список (всегда true)
  inKk: boolean; // КК Сопровождение (есть клиенты)
  kkActiveClients: number;
  inViolations: boolean; // встречается в журнале «Нарушения»
  violationCount: number;
  inKpi: boolean; // есть строка в листе «KPI и результаты»
  role: string | null;
}

export interface ProblemItem {
  client: string | null;
  date: string | null;
  type: string | null;
  employee: string; // сопоставленное имя (или исходное, если не валидно)
  matched: boolean;
  description: string | null;
  status: string | null;
}

export interface UnmatchedName {
  name: string;
  status: "invalid" | "review";
  /** Где встретилось. */
  sources: string[];
  violationCount: number;
}

export interface EmployeeAudit {
  meta: typeof AUDIT_SOURCE.meta;
  valid: ValidEmployee[];
  /** Отсутствующие: каждый источник → список валидных сотрудников без данных. */
  missing: {
    kk: string[]; // нет в КК Сопровождении
    violations: string[]; // нет в журнале нарушений (это скорее хорошо)
    kpi: string[]; // нет в листе KPI
  };
  invalidNames: UnmatchedName[]; // раздел C
  reviewNames: UnmatchedName[]; // требует ручной проверки
  violations: AuditViolation[]; // раздел D (только валидные)
  penalties: MoneyItem[]; // раздел E — санкции (драм)
  bonuses: MoneyItem[]; // раздел E — бонусы
  sourceMatrix: SourceRow[]; // раздел F
  problems: ProblemItem[];
  totals: {
    validCount: number;
    missingCount: number; // валидных, отсутствующих хотя бы в одном источнике
    invalidCount: number;
    reviewCount: number;
    violationCount: number; // подтверждённых+валидных
    penaltiesTotal: number; // сумма санкций (драм) по валидным
    bonusCount: number; // число бонусов по валидным
    droppedViolations: number; // нарушений отброшено (невалидные/на проверке имена)
  };
}

const SRC_VIOLATIONS = "Excel «Нарушения»";
const SRC_KPI = "Excel «KPI и результаты»";
const SRC_KK = "КК Сопровождение";
const SRC_PROBLEMS = "Excel «Проблемы и достижения»";

/** Нарушение считаем подтверждённым, если есть решение или закрытая апелляция. */
function isConfirmed(v: RawViolation): boolean {
  return Boolean(v.resolution) || /отклон|подтвержд|принят/i.test(v.appeal ?? "");
}

export function buildEmployeeAudit(): EmployeeAudit {
  const { violations, kpi, problems, kkActive, kkAll, meta } = AUDIT_SOURCE;

  // --- присутствие по источникам (по каноническому короткому имени) ---
  const kkByEmp = new Map<string, number>(); // canonical short → active clients
  for (const [name, n] of Object.entries(kkActive)) {
    const short = canonicalShortName(name);
    if (short) kkByEmp.set(short, (kkByEmp.get(short) ?? 0) + n);
  }
  // если у бухгалтера нет Active, но есть клиенты всего — тоже считаем присутствием
  for (const [name, n] of Object.entries(kkAll)) {
    const short = canonicalShortName(name);
    if (short && !kkByEmp.has(short)) kkByEmp.set(short, 0);
    if (short && n > 0 && !kkByEmp.has(short)) kkByEmp.set(short, 0);
  }

  const kpiByEmp = new Set<string>();
  for (const k of kpi) {
    const short = canonicalShortName(k.name);
    if (short) kpiByEmp.add(short);
  }

  // --- нарушения: разбор + агрегаты по невалидным именам ---
  const auditViolations: AuditViolation[] = [];
  const violCountByEmp = new Map<string, number>();
  const unmatched = new Map<
    string,
    { status: "invalid" | "review"; sources: Set<string>; count: number }
  >();
  let dropped = 0;

  for (const v of violations) {
    const r = resolveEmployee(v.accountant);
    if (r.status === "valid") {
      const short = r.employee.short;
      violCountByEmp.set(short, (violCountByEmp.get(short) ?? 0) + 1);
      auditViolations.push({
        date: v.date,
        employee: short,
        employeeFull: r.employee.canonical,
        client: v.client,
        severity: v.severity,
        type: v.gross || v.service || v.standard,
        gross: Boolean(v.gross) || /груб/i.test(v.severity ?? ""),
        source: SRC_VIOLATIONS,
        explanation: v.description,
        sanction: v.sanction,
        confirmed: isConfirmed(v),
      });
    } else if (r.status === "unassigned") {
      dropped += 1;
    } else {
      dropped += 1;
      const key = r.name;
      const rec =
        unmatched.get(key) ??
        { status: r.status, sources: new Set<string>(), count: 0 };
      rec.sources.add(SRC_VIOLATIONS);
      rec.count += 1;
      unmatched.set(key, rec);
    }
  }
  auditViolations.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  // невалидные имена также из KPI и КК Сопровождения
  const noteUnmatched = (name: string, source: string) => {
    const r = resolveEmployee(name);
    if (r.status !== "invalid" && r.status !== "review") return;
    const key = r.name;
    const rec =
      unmatched.get(key) ??
      { status: r.status, sources: new Set<string>(), count: 0 };
    rec.sources.add(source);
    unmatched.set(key, rec);
  };
  for (const k of kpi) noteUnmatched(k.name, SRC_KPI);
  for (const name of Object.keys(kkAll)) noteUnmatched(name, SRC_KK);
  for (const p of problems) noteUnmatched(p.accountant ?? "", SRC_PROBLEMS);

  const invalidNames: UnmatchedName[] = [];
  const reviewNames: UnmatchedName[] = [];
  for (const [name, rec] of unmatched) {
    const item: UnmatchedName = {
      name,
      status: rec.status,
      sources: [...rec.sources],
      violationCount: rec.count,
    };
    (rec.status === "invalid" ? invalidNames : reviewNames).push(item);
  }
  invalidNames.sort((a, b) => b.violationCount - a.violationCount);
  reviewNames.sort((a, b) => b.violationCount - a.violationCount);

  // --- деньги: санкции и бонусы из KPI (только валидные) ---
  const penalties: MoneyItem[] = [];
  const bonuses: MoneyItem[] = [];
  for (const k of kpi) {
    const r = resolveEmployee(k.name);
    if (r.status !== "valid") continue;
    const emp = r.employee;
    for (const [month, m] of Object.entries(k.months)) {
      if (typeof m.sanction === "number" && m.sanction > 0) {
        penalties.push({
          employee: emp.short,
          employeeFull: emp.canonical,
          month,
          amount: m.sanction,
          text: null,
        });
      }
      if (m.bonus && m.bonus !== "Нет") {
        const amount = /^[\d\s,]+$/.test(m.bonus)
          ? Number(m.bonus.replace(/[,\s]/g, ""))
          : null;
        bonuses.push({
          employee: emp.short,
          employeeFull: emp.canonical,
          month,
          amount,
          text: m.bonus,
        });
      }
    }
  }
  penalties.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
  const penaltiesTotal = penalties.reduce((s, p) => s + (p.amount ?? 0), 0);

  // --- матрица источников (раздел F) ---
  const sourceMatrix: SourceRow[] = VALID_EMPLOYEES.map((e) => ({
    employee: e.short,
    employeeFull: e.canonical,
    inList: true,
    inKk: kkByEmp.has(e.short),
    kkActiveClients: kkByEmp.get(e.short) ?? 0,
    inViolations: (violCountByEmp.get(e.short) ?? 0) > 0,
    violationCount: violCountByEmp.get(e.short) ?? 0,
    inKpi: kpiByEmp.has(e.short),
    role: e.role,
  }));

  // --- отсутствующие ---
  const missing = {
    kk: VALID_EMPLOYEES.filter((e) => !kkByEmp.has(e.short)).map((e) => e.canonical),
    violations: VALID_EMPLOYEES.filter(
      (e) => (violCountByEmp.get(e.short) ?? 0) === 0
    ).map((e) => e.canonical),
    kpi: VALID_EMPLOYEES.filter((e) => !kpiByEmp.has(e.short)).map((e) => e.canonical),
  };
  const missingCount = VALID_EMPLOYEES.filter(
    (e) =>
      !kkByEmp.has(e.short) ||
      (violCountByEmp.get(e.short) ?? 0) === 0 ||
      !kpiByEmp.has(e.short)
  ).length;

  // --- проблемы и достижения (сопоставление имён) ---
  const problemItems: ProblemItem[] = problems.map((p) => {
    const r = resolveEmployee(p.accountant);
    return {
      client: p.client,
      date: p.date,
      type: p.type,
      employee: r.status === "valid" ? r.employee.canonical : (p.accountant ?? "—"),
      matched: r.status === "valid",
      description: p.description,
      status: p.status,
    };
  });

  return {
    meta,
    valid: VALID_EMPLOYEES,
    missing,
    invalidNames,
    reviewNames,
    violations: auditViolations,
    penalties,
    bonuses,
    sourceMatrix,
    problems: problemItems,
    totals: {
      validCount: VALID_EMPLOYEES.length,
      missingCount,
      invalidCount: invalidNames.length,
      reviewCount: reviewNames.length,
      violationCount: auditViolations.length,
      penaltiesTotal,
      bonusCount: bonuses.length,
      droppedViolations: dropped,
    },
  };
}
