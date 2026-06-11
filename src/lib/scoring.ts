// ---------------------------------------------------------------------------
// Config-driven scoring engine — matches Margarita's "Правила (копия)" tab and
// her written rules (June 2026). All criteria / statuses / bands are DATA.
//
// MODEL:
//   Итоговая оценка = Точность и полнота (вес 50) + Соблюдение сроков/SLA (вес 50)
//   Each criterion is 0..5: contribution = score × 50 ÷ 5. Max = 50 + 50 = 100.
//
//   HARD GATE: if ANY mandatory mailing (налоги / зарплата / первичка / долги)
//   is in a "not done" status, the whole chat's score becomes 1 (Критично),
//   regardless of the two criteria.
//
//   "Предстоящая" and "Inactive" never penalise.
// ---------------------------------------------------------------------------

export type CriterionId = "accuracy" | "sla";

export interface Criterion {
  id: CriterionId;
  name: string;
  weight: number; // accuracy 50 + sla 50 = 100
  scaleMax: number;
  descriptions: Record<number, string>;
  daily: boolean;
}

export const CRITERIA: Criterion[] = [
  {
    id: "accuracy",
    name: "Точность и полнота",
    weight: 50,
    scaleMax: 5,
    daily: true,
    descriptions: {
      0: "Информация неверна или отсутствует",
      1: "Много ошибок / крупные пробелы",
      2: "Заметные ошибки или пропуски",
      3: "Логика верна, но без деталей",
      4: "Точно, незначительные уточнения",
      5: "Всё верно, учтён режим клиента, даны шаги/ссылки",
    },
  },
  {
    id: "sla",
    name: "Соблюдение сроков / SLA",
    weight: 50,
    scaleMax: 5,
    daily: true,
    descriptions: {
      0: "Сроки сорваны",
      1: "Сильная задержка",
      2: "Заметная задержка",
      3: "Формально в срок",
      4: "В срок с небольшим запасом",
      5: "Вовремя или раньше, перенос согласован",
    },
  },
];

export const DAILY_CRITERIA = CRITERIA;

// --- Monthly mailings (the four status columns) ----------------------------

export interface MonthlyCategory {
  id: string;
  name: string;
  shortName: string;
  dueDay: number;
  statuses: readonly string[];
  /** Statuses that force the whole chat's score to 1. */
  failStatuses: readonly string[];
}

export const MONTHLY_CATEGORIES: MonthlyCategory[] = [
  {
    id: "main_taxes",
    name: "До 15 — основные налоги",
    shortName: "Налоги",
    dueDay: 15,
    statuses: ["Отправил", "Не отправил", "Предстоящая", "Inactive"],
    failStatuses: ["Не отправил"],
  },
  {
    id: "salary",
    name: "До 10 — заработная плата",
    shortName: "Зарплата",
    dueDay: 10,
    statuses: [
      "Получил",
      "Запросил 1, не получил",
      "Запросил 2, не получил",
      "Не запросил 1",
      "Не запросил 2",
      "Предстоящая",
      "Inactive",
    ],
    failStatuses: ["Не запросил 1", "Не запросил 2"],
  },
  {
    id: "primary_docs",
    name: "До 28 — первичная документация",
    shortName: "Первичка",
    dueDay: 28,
    statuses: [
      "Получил",
      "Запросил 1, не получил",
      "Запросил 2, не получил",
      "Не запросил 1",
      "Не запросил 2",
      "Предстоящая",
      "Inactive",
    ],
    failStatuses: ["Не запросил 1", "Не запросил 2"],
  },
  {
    id: "debts",
    name: "Долги — до 5",
    shortName: "Долги",
    dueDay: 5,
    statuses: [
      "Нет долга",
      "1-й написал",
      "2-й написал",
      "1-й позвонил",
      "Не написал 1",
      "Не написал 2",
      "Предстоящая",
      "Inactive",
    ],
    failStatuses: ["Не написал 1", "Не написал 2"],
  },
];

export const PREV_STATUS_DEFAULT = "--";

/** Score a failing chat gets when a mandatory mailing is not done. */
export const FAIL_SCORE = 1;

/** True if the monthly statuses trigger the hard gate (-> score 1). */
export function isMailingFail(
  monthly?: Record<string, { status: string }>
): boolean {
  if (!monthly) return false;
  for (const cat of MONTHLY_CATEGORIES) {
    const s = monthly[cat.id]?.status;
    if (s && cat.failStatuses.includes(s)) return true;
  }
  return false;
}

/** Which mailing(s) caused the failure (for messages / explanations). */
export function failingMailings(
  monthly?: Record<string, { status: string }>
): { category: string; status: string }[] {
  const out: { category: string; status: string }[] = [];
  if (!monthly) return out;
  for (const cat of MONTHLY_CATEGORIES) {
    const s = monthly[cat.id]?.status;
    if (s && cat.failStatuses.includes(s)) out.push({ category: cat.shortName, status: s });
  }
  return out;
}

// --- Single-task (the "Задачи" tab) ----------------------------------------

export const SINGLE_TASK_STATUSES = [
  "Completed (On Time)",
  "Completed (Late)",
  "Overdue",
  "Cancelled",
  "-",
] as const;

export const TASK_PRIORITIES = ["Low", "Medium", "High"] as const;

export function isTaskOnTime(status: string | null): boolean {
  return status === "Completed (On Time)";
}
export function isTaskLate(status: string | null): boolean {
  return status === "Completed (Late)";
}
export function isTaskOverdue(status: string | null): boolean {
  return status === "Overdue";
}

// --- Quality bands ---------------------------------------------------------

export type QualityBand = "Отлично" | "Хорошо" | "Плохо" | "Критично";

export interface BandDef {
  band: QualityBand;
  min: number;
  max: number;
  color: string;
}

// Отлично 90–100, Хорошо 80–89, Плохо 60–79, Критично 1–59 (a gated chat = 1).
export const BANDS: BandDef[] = [
  { band: "Отлично", min: 90, max: 100, color: "#16a34a" },
  { band: "Хорошо", min: 80, max: 89, color: "#65a30d" },
  { band: "Плохо", min: 60, max: 79, color: "#d97706" },
  { band: "Критично", min: 1, max: 59, color: "#dc2626" },
];

export function bandFor(total: number): QualityBand {
  const t = Math.round(total);
  for (const b of BANDS) if (t >= b.min && t <= b.max) return b.band;
  return "Критично";
}

export function bandColor(band: QualityBand): string {
  return BANDS.find((b) => b.band === band)?.color ?? "#6b7280";
}

// --- Total -----------------------------------------------------------------

export type CriteriaScores = Partial<Record<CriterionId, number>>;

/**
 * Итоговая оценка. Hard gate first: any failing mailing -> 1. Otherwise
 * Σ(score × weight ÷ 5) over the two criteria. Un-entered criteria count as
 * full marks (a chat with everything in order defaults to 100).
 */
export function computeOverall(
  scores: CriteriaScores,
  monthly?: Record<string, { status: string }>,
  criteria: Criterion[] = CRITERIA
): number {
  if (isMailingFail(monthly)) return FAIL_SCORE;
  let total = 0;
  for (const c of criteria) {
    const raw = scores[c.id];
    const value =
      typeof raw === "number" && !Number.isNaN(raw)
        ? Math.max(0, Math.min(c.scaleMax, raw))
        : c.scaleMax;
    total += (value * c.weight) / c.scaleMax;
  }
  return Math.round(total * 100) / 100;
}

/** Strict variant (missing criteria = 0), no gate. Used in tests / explicit use. */
export function computeWeightedTotal(
  scores: CriteriaScores,
  criteria: Criterion[] = CRITERIA
): number {
  let total = 0;
  for (const c of criteria) {
    const raw = scores[c.id];
    if (typeof raw !== "number" || Number.isNaN(raw)) continue;
    total += (Math.max(0, Math.min(c.scaleMax, raw)) * c.weight) / c.scaleMax;
  }
  return Math.round(total * 100) / 100;
}

export type ScoringModel = "weighted";
export const ACTIVE_MODEL: ScoringModel = "weighted";
