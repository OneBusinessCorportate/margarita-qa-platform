// ---------------------------------------------------------------------------
// Config-driven scoring engine.
//
// The scoring model has an UNRESOLVED ambiguity (see build brief "Open
// questions"). We therefore keep BOTH representations as *data*, not hardcoded
// in JSX, so the live model can be switched without a rewrite:
//
//   (A) 4 weighted criteria  -> weighted total 0..100   [LIVE by default]
//   (B) per-task statuses     -> derived total 0..100   [supported, opt-in]
//
// TODO(margarita): confirm which model is live. Default = (A) weighted criteria.
// ---------------------------------------------------------------------------

export type CriterionId =
  | "accuracy"
  | "sla"
  | "fcr"
  | "clarity";

export interface Criterion {
  id: CriterionId;
  /** Display name (Armenian/Russian as used in the sheet). */
  name: string;
  /** Weight; weights across all active criteria should sum to 100. */
  weight: number;
  /** Top of the 0..scaleMax integer scale. */
  scaleMax: number;
  /** Human description for each point on the scale. */
  descriptions: Record<number, string>;
}

// (A) The 4 weighted criteria found in the sheet.
export const CRITERIA: Criterion[] = [
  {
    id: "accuracy",
    name: "Точность и полнота",
    weight: 40,
    scaleMax: 5,
    descriptions: {
      0: "Информация неверна или отсутствует",
      1: "Много ошибок / крупные пробелы",
      2: "Заметные ошибки или пропуски",
      3: "В целом верно, мелкие недочёты",
      4: "Точно, незначительные уточнения",
      5: "Полностью точно и исчерпывающе",
    },
  },
  {
    id: "sla",
    name: "Соблюдение сроков / СЛА",
    weight: 25,
    scaleMax: 5,
    descriptions: {
      0: "Сроки сорваны",
      1: "Сильная задержка",
      2: "Заметная задержка",
      3: "На грани срока",
      4: "В срок с небольшим запасом",
      5: "С опережением срока",
    },
  },
  {
    id: "fcr",
    name: "Решение с первого контакта / FCR",
    weight: 20,
    scaleMax: 5,
    descriptions: {
      0: "Вопрос не решён",
      1: "Потребовалось много итераций",
      2: "Несколько повторных обращений",
      3: "Решено за пару обращений",
      4: "Почти с первого раза",
      5: "Решено с первого контакта",
    },
  },
  {
    id: "clarity",
    name: "Ясность коммуникации",
    weight: 15,
    scaleMax: 5,
    descriptions: {
      0: "Непонятно, сбивчиво",
      1: "Тяжело понять",
      2: "Местами неясно",
      3: "Понятно в целом",
      4: "Чётко и вежливо",
      5: "Образцовая ясность и тон",
    },
  },
];

// (B) Per-task statuses model. Each category has a due day and an allowed
// status enum. Statuses that penalize the score carry a penalty 0..1 that
// scales the category's contribution.
//
// TODO(margarita): confirm full allowed status list per category and which
// statuses penalize (and by how much). Values below are sensible defaults.
export interface TaskCategoryConfig {
  id: string;
  name: string;
  /** Day of month the task is due. */
  dueDay: number;
  /** Equal-weight share of the 0..100 total when model (B) is active. */
  weight: number;
  /** status -> credit multiplier (1 = full credit, 0 = no credit). */
  statusCredit: Record<string, number>;
}

export const TASK_CATEGORIES: TaskCategoryConfig[] = [
  {
    id: "main_taxes",
    name: "Основные налоги",
    dueDay: 15,
    weight: 30,
    statusCredit: {
      "Предстоящая": 1,
      "Отправил": 1,
      "Получил": 1,
      "Запросил 1, не получил": 0.5,
      "Не запросил 1": 0,
      "--": 1,
    },
  },
  {
    id: "salary",
    name: "Заработная плата",
    dueDay: 10,
    weight: 25,
    statusCredit: {
      "Предстоящая": 1,
      "Отправил": 1,
      "Получил": 1,
      "Запросил 1, не получил": 0.5,
      "Не запросил 1": 0,
      "--": 1,
    },
  },
  {
    id: "primary_docs",
    name: "Первичная документация / очная встреча",
    dueDay: 28,
    weight: 25,
    statusCredit: {
      "Предстоящая": 1,
      "1ый/2ой написал": 1,
      "Не написал 1": 0,
      "--": 1,
    },
  },
  {
    id: "debts",
    name: "Долги",
    dueDay: 5,
    weight: 20,
    statusCredit: {
      "Предстоящая": 1,
      "нет долга": 1,
      "Отправил": 1,
      "Не запросил 1": 0,
      "--": 1,
    },
  },
];

export type QualityBand = "Отлично" | "Хорошо" | "Плохо" | "Критично";

export interface BandDef {
  band: QualityBand;
  min: number;
  max: number;
  color: string; // tailwind-ish hex for chips
}

// Quality bands: Отлично 90–100, Хорошо 80–89, Плохо 60–79, Критично 1–59.
export const BANDS: BandDef[] = [
  { band: "Отлично", min: 90, max: 100, color: "#16a34a" },
  { band: "Хорошо", min: 80, max: 89, color: "#65a30d" },
  { band: "Плохо", min: 60, max: 79, color: "#d97706" },
  { band: "Критично", min: 1, max: 59, color: "#dc2626" },
];

/** Map a 0..100 total to its quality band. 0 (unscored) -> Критично. */
export function bandFor(total: number): QualityBand {
  const t = Math.round(total);
  for (const b of BANDS) {
    if (t >= b.min && t <= b.max) return b.band;
  }
  // Below 1 -> treat as Критично (unscored / failing).
  return "Критично";
}

export function bandColor(band: QualityBand): string {
  return BANDS.find((b) => b.band === band)?.color ?? "#6b7280";
}

// --- Model (A): weighted criteria ------------------------------------------

export type CriteriaScores = Partial<Record<CriterionId, number>>;

/**
 * Weighted total for model (A): Σ(score × weight ÷ scaleMax).
 * With weights summing to 100 and scaleMax 5, max total = 100.
 */
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

// --- Model (B): task statuses ----------------------------------------------

export type TaskStatusScores = Record<string, string>; // categoryId -> status

/**
 * Derived total for model (B). Each category contributes weight × credit,
 * where credit comes from statusCredit (default 1 for unknown statuses so
 * unconfigured statuses never silently zero out a score).
 *
 * TODO(margarita): confirm exact derivation of "Общая оценка" from statuses.
 */
export function computeTaskStatusTotal(
  statuses: TaskStatusScores,
  categories: TaskCategoryConfig[] = TASK_CATEGORIES
): number {
  let total = 0;
  for (const cat of categories) {
    const status = statuses[cat.id];
    const credit = status === undefined ? 1 : cat.statusCredit[status] ?? 1;
    total += cat.weight * credit;
  }
  return Math.round(total * 100) / 100;
}

/** Active scoring model. Switch here (or wire to config) to flip the platform. */
export type ScoringModel = "weighted" | "task_status";
export const ACTIVE_MODEL: ScoringModel = "weighted"; // TODO(margarita): confirm
