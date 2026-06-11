// ---------------------------------------------------------------------------
// Config-driven scoring engine — modelled on Margarita's Google Sheet
// ("Правила" / "Оценка" tabs). All criteria, statuses and bands are DATA so
// they can change without touching the UI.
//
// Scoring model (from "Правила"):
//   4 weighted criteria, weighted total = Σ(score × weight ÷ 5), range 0..100.
//     Точность и полнота — 40, Соблюдение сроков/СЛА — 25,
//     Решение с первого контакта (FCR) — 20, Ясность коммуникации — 15.
//
// In the daily "Оценка" grid she records the first TWO scores plus the four
// monthly task statuses; "Общая оценка" (0..100) is stored per row. We compute
// it from the criteria (treating un-entered criteria as full marks) but allow
// a manual override, matching how the sheet behaves.
//
// TODO(margarita): confirm exactly how "Общая оценка" is derived from the two
// daily scores + task statuses (open question — pending her answer).
// ---------------------------------------------------------------------------

export type CriterionId = "accuracy" | "sla" | "fcr" | "clarity";

export interface Criterion {
  id: CriterionId;
  name: string;
  weight: number; // weights across active criteria sum to 100
  scaleMax: number; // 0..scaleMax integer scale
  descriptions: Record<number, string>;
  /** Whether this criterion is entered in the daily Оценка grid. */
  daily: boolean;
}

export const CRITERIA: Criterion[] = [
  {
    id: "accuracy",
    name: "Точность и полнота",
    weight: 40,
    scaleMax: 5,
    daily: true,
    descriptions: {
      0: "Информация неверна или отсутствует",
      1: "Много ошибок / крупные пробелы",
      2: "Заметные ошибки или пропуски",
      3: "В целом верно, мелкие недочёты",
      4: "Точно, незначительные уточнения",
      5: "Всё верно, учтён режим клиента, даны шаги/ссылки",
    },
  },
  {
    id: "sla",
    name: "Соблюдение сроков / СЛА",
    weight: 25,
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
  {
    id: "fcr",
    name: "Решение с первого контакта / FCR",
    weight: 20,
    scaleMax: 5,
    daily: false,
    descriptions: {
      0: "Вопрос не решён",
      1: "Потребовалось много итераций",
      2: "Несколько повторных обращений",
      3: "Решено за пару обращений",
      4: "Почти с первого раза",
      5: "Вопрос клиента закрыт полностью с первого раза",
    },
  },
  {
    id: "clarity",
    name: "Ясность коммуникации",
    weight: 15,
    scaleMax: 5,
    daily: false,
    descriptions: {
      0: "Непонятно, сбивчиво",
      1: "Тяжело понять",
      2: "Местами неясно",
      3: "Верно, но громоздко",
      4: "Чётко и вежливо",
      5: "Структурировано, просто, чек-лист",
    },
  },
];

export const DAILY_CRITERIA = CRITERIA.filter((c) => c.daily);

// --- Monthly task categories (the four status columns in "Оценка") ---------

export interface MonthlyCategory {
  id: string;
  name: string; // as shown in the sheet
  shortName: string;
  dueDay: number;
  statuses: readonly string[]; // allowed statuses for this category
}

// Statuses observed across the sheet for the deadline-driven categories.
export const MONTHLY_STATUSES = [
  "Предстоящая",
  "Запросил 1, не получил",
  "Не запросил 1",
  "Отправил",
  "Получил",
  "1ый написал",
  "2ой написал",
  "1ый/2ой написал",
  "Не написал 1",
  "Не написал 2",
  "--",
] as const;

// Долги uses a slightly different set (нет долга instead of Отправил/Получил).
export const DEBT_STATUSES = [
  "Предстоящая",
  "нет долга",
  "1ый написал",
  "2ой написал",
  "Не написал 1",
  "Не написал 2",
  "--",
] as const;

export const MONTHLY_CATEGORIES: MonthlyCategory[] = [
  {
    id: "main_taxes",
    name: "до 15 основные налоги",
    shortName: "Налоги",
    dueDay: 15,
    statuses: MONTHLY_STATUSES,
  },
  {
    id: "salary",
    name: "до 10 заработная плата",
    shortName: "Зарплата",
    dueDay: 10,
    statuses: MONTHLY_STATUSES,
  },
  {
    id: "primary_docs",
    name: "до 28 первичная документация и очная встреча",
    shortName: "Первичка",
    dueDay: 28,
    statuses: MONTHLY_STATUSES,
  },
  {
    id: "debts",
    name: "Долги до 5",
    shortName: "Долги",
    dueDay: 5,
    statuses: DEBT_STATUSES,
  },
];

export const PREV_STATUS_DEFAULT = "--";

// Statuses that LOWER the Общая оценка, and by how many points each. Statuses
// not listed (e.g. "Получил", "нет долга", "Предстоящая", "Отправил",
// "1ый написал", "--") carry no penalty.
// TODO(margarita): confirm exactly which statuses penalize and the magnitudes.
export const STATUS_PENALTIES: Record<string, number> = {
  "Не запросил 1": 10,
  "Запросил 1, не получил": 5,
  "Не написал 1": 10,
  "Не написал 2": 15,
};

/** Total penalty across the four monthly statuses of an evaluation. */
export function statusPenalty(
  monthly?: Record<string, { status: string }>
): number {
  if (!monthly) return 0;
  let p = 0;
  for (const cat of MONTHLY_CATEGORIES) {
    const s = monthly[cat.id]?.status;
    if (s) p += STATUS_PENALTIES[s] ?? 0;
  }
  return p;
}

// --- Single-task (the "Single task" block + "Задачи" tab) ------------------

export const SINGLE_TASK_STATUSES = [
  "Completed (On Time)",
  "Completed (Late)",
  "Overdue",
  "Cancelled",
  "-",
] as const;

export const TASK_PRIORITIES = ["Low", "Medium", "High"] as const;

/** Single-task statuses that count as "done" vs "problem" for the report. */
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

// --- Weighted total --------------------------------------------------------

export type CriteriaScores = Partial<Record<CriterionId, number>>;

/**
 * Weighted total: Σ(score × weight ÷ scaleMax). Criteria not present in the
 * map contribute their FULL weight (the daily grid only captures accuracy +
 * sla; fcr/clarity are assumed full unless explicitly scored down).
 * TODO(margarita): confirm this default.
 */
export function computeOverall(
  scores: CriteriaScores,
  monthly?: Record<string, { status: string }>,
  criteria: Criterion[] = CRITERIA
): number {
  let total = 0;
  for (const c of criteria) {
    const raw = scores[c.id];
    const value =
      typeof raw === "number" && !Number.isNaN(raw)
        ? Math.max(0, Math.min(c.scaleMax, raw))
        : c.scaleMax; // un-entered -> full marks
    total += (value * c.weight) / c.scaleMax;
  }
  // Monthly task statuses can lower the score.
  total = Math.max(0, total - statusPenalty(monthly));
  return Math.round(total * 100) / 100;
}

/** Strict variant: missing criteria count as 0 (used by tests / explicit use). */
export function computeWeightedTotal(
  scores: CriteriaScores,
  criteria: Criterion[] = CRITERIA
): number {
  let total = 0;
  for (const c of criteria) {
    const raw = scores[c.id];
    if (typeof raw !== "number" || Number.isNaN(raw)) continue;
    const clamped = Math.max(0, Math.min(c.scaleMax, raw));
    total += (clamped * c.weight) / c.scaleMax;
  }
  return Math.round(total * 100) / 100;
}

export type ScoringModel = "weighted" | "task_status";
export const ACTIVE_MODEL: ScoringModel = "weighted"; // TODO(margarita): confirm
