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
//   GREETING RULE (Margarita, June 2026): the accountant must greet the client
//   at the very start of the chat / when answering, or answer the client's
//   greeting. If they don't, "Точность и полнота" is capped at 4 (a small −1,
//   NOT critical — just a mistake).
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
  /**
   * The routine "done" status for this mailing (e.g. «Отправил» / «Получил»).
   * Once the due day passes, the auto-fill defaults to this so Margarita only
   * flips the exceptions instead of marking every chat by hand. Omitted for
   * «Долги», whose follow-up is always her judgement.
   */
  expectedStatus?: string;
}

export const MONTHLY_CATEGORIES: MonthlyCategory[] = [
  {
    id: "main_taxes",
    name: "До 15 — основные налоги",
    shortName: "Налоги",
    dueDay: 15,
    statuses: ["Отправил", "Не отправил", "Предстоящая", "Inactive"],
    failStatuses: ["Не отправил"],
    expectedStatus: "Отправил",
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
    expectedStatus: "Получил",
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
    expectedStatus: "Получил",
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

/**
 * Map a (possibly mis-cased or legacy) status string to the category's canonical
 * option, or "" if it isn't one. Carried-forward / imported data sometimes has
 * "нет долга" where the option is "Нет долга" — without this the <select> shows
 * nothing because the value matches no <option>.
 */
export function canonicalMonthlyStatus(
  cat: MonthlyCategory,
  s?: string | null
): string {
  const t = (s ?? "").trim();
  if (!t) return "";
  return cat.statuses.find((x) => x.toLowerCase() === t.toLowerCase()) ?? "";
}

/** Score a failing chat gets when a mandatory mailing is not done. */
export const FAIL_SCORE = 1;

// --- Greeting rule ----------------------------------------------------------

/** Did the accountant greet the client / answer the greeting? */
export type Greeting = "yes" | "no";

/**
 * Missing greeting caps "Точность и полнота" at this score — a small −1, not
 * critical (Margarita's rule). Only the `accuracy` criterion is affected.
 */
export const GREETING_ACCURACY_CAP = 4;

/** Apply the greeting rule to an accuracy score (no greeting → max 4). */
export function cappedAccuracy(accuracy: number, greeting?: Greeting): number {
  return greeting === "no" ? Math.min(accuracy, GREETING_ACCURACY_CAP) : accuracy;
}

// --- Chat activity ("active" = recently active, not just status=Active) -----

/**
 * A chat whose last real activity is older than this many days (relative to the
 * date being reviewed) is shown as stale — it is NOT a live "active" chat even
 * if its status flag still says "Active".
 */
export const STALE_ACTIVITY_DAYS = 3;

/** Whole days between two ISO dates (date-only). Negative if `to` precedes `from`. */
export function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(fromISO.slice(0, 10));
  const b = Date.parse(toISO.slice(0, 10));
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** True if `lastActivity` is more than STALE_ACTIVITY_DAYS before `asOf`. */
export function isStaleActivity(
  lastActivity: string | null | undefined,
  asOf: string,
  windowDays: number = STALE_ACTIVITY_DAYS
): boolean {
  if (!lastActivity) return true; // never seen any activity
  return daysBetween(lastActivity, asOf) > windowDays;
}

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

/** Was the task marked done/cancelled by the accountant? */
export function isTaskCompleted(status: string | null | undefined): boolean {
  return (
    status === "Completed (On Time)" ||
    status === "Completed (Late)" ||
    status === "Cancelled"
  );
}

/**
 * Is the task CLOSED (off Margarita's plate)? A normal task closes when the
 * accountant completes/cancels it. A recurring / non-closable task (the boss's
 * rule) only closes when the accountant did it AND QA confirmed it — so it stays
 * open through every period until both are true.
 */
export function isTaskClosed(t: {
  task_status: string | null | undefined;
  recurring?: boolean | null;
  qa_confirmed?: boolean | null;
}): boolean {
  if (!isTaskCompleted(t.task_status)) return false;
  if (t.recurring) return t.qa_confirmed === true;
  return true;
}

/**
 * Is an open task past (or at) its deadline as of `asOf`? Uses the postponed
 * due date when present (the accountant moved it), else the original. Closed
 * tasks are never "due". This is what flags a "вернётся через 2 дня" promise that
 * has come due (item 8).
 */
export function isTaskDue(
  t: {
    task_status: string | null | undefined;
    recurring?: boolean | null;
    qa_confirmed?: boolean | null;
    due_date_original?: string | null;
    due_date_postponed?: string | null;
  },
  asOf: string
): boolean {
  if (isTaskClosed(t)) return false;
  const due = (t.due_date_postponed || t.due_date_original || "").slice(0, 10);
  if (!due) return false;
  return due <= asOf.slice(0, 10);
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
 * full marks (a chat with everything in order defaults to 100). A missing
 * greeting caps "Точность и полнота" at GREETING_ACCURACY_CAP.
 */
export function computeOverall(
  scores: CriteriaScores,
  monthly?: Record<string, { status: string }>,
  criteria: Criterion[] = CRITERIA,
  greeting?: Greeting
): number {
  if (isMailingFail(monthly)) return FAIL_SCORE;
  let total = 0;
  for (const c of criteria) {
    const raw = scores[c.id];
    let value =
      typeof raw === "number" && !Number.isNaN(raw)
        ? Math.max(0, Math.min(c.scaleMax, raw))
        : c.scaleMax;
    if (c.id === "accuracy") value = cappedAccuracy(value, greeting);
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

// ===========================================================================
// ALTERNATE EVALUATION SCHEMES — "варианты оценки с разными баллами".
//
// Different roles are graded on different models with different point systems,
// migrated here from Margarita's spreadsheets so the whole company's QA lives
// in one place. Everything below is DATA, just like the accounting model above.
//
//   • accounting      — Бухгалтерия, сервис чатов (the weighted model above:
//                        Точность + СЛА + рассылки + приветствие → 0..100).
//   • accounting_kpi  — Бухгалтерия, месячный KPI (Уведомления / CSAT /
//                        Чаты-Сервис, взвешенно → 0..100).
//   • registration    — Регистрационный отдел, еженедельная оценка менеджеров
//                        (старт 100, вычитаем штрафные баллы за нарушения).
//
// All three reuse the same quality BANDS (Отлично/Хорошо/Плохо/Критично).
// ===========================================================================

export type SchemeId =
  | "accounting"
  | "accounting_kpi"
  | "registration"
  | "kk_quality";

export type SchemeKind = "weighted" | "kpi" | "penalty";

export interface SchemeInfo {
  id: SchemeId;
  name: string;
  department: string;
  /** Who is being graded. */
  subject: string;
  kind: SchemeKind;
  description: string;
}

export const SCHEMES: SchemeInfo[] = [
  {
    id: "accounting",
    name: "Бухгалтерия — сервис чатов",
    department: "Бухгалтерия",
    subject: "Бухгалтер",
    kind: "weighted",
    description:
      "Ежедневная оценка чатов: Точность и полнота + Соблюдение сроков / SLA, " +
      "статусы рассылок (налоги / ЗП / первичка / долги) и приветствие. 0–100.",
  },
  {
    id: "accounting_kpi",
    name: "Бухгалтерия — месячный KPI",
    department: "Бухгалтерия",
    subject: "Бухгалтер",
    kind: "kpi",
    description:
      "Итоговая месячная оценка: Уведомления×30% + CSAT×40% + Чаты/Сервис×30%. " +
      "Порог квартального бонуса: Чаты/Сервис ≥ 90, уведомления 100%, CSAT ≥ 80.",
  },
  {
    id: "registration",
    name: "Регистрационный отдел — еженедельная оценка",
    department: "Регистрационный отдел",
    subject: "Менеджер",
    kind: "penalty",
    description:
      "Старт 100 баллов, вычитаем штрафы за нарушения недели: критические ошибки, " +
      "скорость ответа (≤ 15 мин), обратная связь клиенту.",
  },
  {
    id: "kk_quality",
    name: "Контроль качества — оценка бухгалтера",
    department: "Бухгалтерия",
    subject: "Бухгалтер",
    kind: "kpi",
    description:
      "Ежемесячная оценка качества: ошибки×10% + сроки×30% + отчётность×20% + " +
      "документы×30% + доработки×10% → 0–100, с уровнем действий.",
  },
];

export function schemeInfo(id: SchemeId): SchemeInfo {
  return SCHEMES.find((s) => s.id === id) ?? SCHEMES[0];
}

// --- Per-chat evaluation roles ---------------------------------------------
//
// A chat is graded once per role per day. The accountant uses the accounting
// chat model; the manager and lawyer both use the registration penalty model
// (start 100, minus penalties) — per Margarita's spreadsheets (the lawyer has
// no dedicated sheet yet, so it mirrors the manager standards).

export type EvalRole = "accountant" | "manager" | "lawyer";

export interface RoleInfo {
  id: EvalRole;
  label: string;
  icon: string;
  scheme: SchemeId;
}

export const EVAL_ROLES: RoleInfo[] = [
  { id: "accountant", label: "Бухгалтер", icon: "🧮", scheme: "accounting" },
  { id: "manager", label: "Менеджер", icon: "👔", scheme: "registration" },
  { id: "lawyer", label: "Юрист", icon: "⚖️", scheme: "registration" },
];

export function roleInfo(id: EvalRole): RoleInfo {
  return EVAL_ROLES.find((r) => r.id === id) ?? EVAL_ROLES[0];
}

// --- Registration department — weekly penalty model ------------------------
//
// "Финансовая сводка" variant (Margarita, June 2026): the manager starts the
// week at 100 and loses points per incident. Critical errors are the harshest:
// the standard is ZERO per day.

/** Score every manager starts the week with before penalties. */
export const REGISTRATION_START = 100;

export interface PenaltyRule {
  id: string;
  name: string;
  /** Points removed PER incident (negative). */
  points: number;
  goal: string;
  consequence: string;
  /** A critical-error rule — the "0 in a day" standard. */
  critical?: boolean;
}

export const REGISTRATION_PENALTIES: PenaltyRule[] = [
  {
    id: "critical",
    name: "Критические ошибки",
    points: -40,
    goal: "0 в день",
    consequence: "Разбор с Маргаритой в тот же день",
    critical: true,
  },
  {
    id: "speed",
    name: "Скорость ответа",
    points: -50,
    goal: "до 15 минут",
    consequence: "Фиксация в журнале нарушений",
  },
  {
    id: "feedback",
    name: "Обратная связь клиенту",
    points: -10,
    goal: "до 19:00",
    consequence: "Предупреждение от Маргариты",
  },
];

/**
 * Registration weekly score: start at 100, subtract `points × count` for each
 * incident type. Floored to 0, capped at 100. `counts` is keyed by PenaltyRule.id.
 */
export function computeRegistrationScore(
  counts: Record<string, number> = {},
  penalties: PenaltyRule[] = REGISTRATION_PENALTIES
): number {
  let total = REGISTRATION_START;
  for (const p of penalties) {
    const n = counts[p.id];
    if (typeof n === "number" && !Number.isNaN(n) && n > 0) {
      total += p.points * Math.floor(n);
    }
  }
  return Math.max(0, Math.min(100, Math.round(total)));
}

// --- Accounting monthly KPI model ------------------------------------------
//
// Decoded from the "KPI и результаты" tab: Итого = Уведомл×0.30 + CSAT×0.40 +
// (Чаты/Сервис)×0.30 (verified: 0/100/100 → 70; 92.73/100/0 → 67.82).

export interface KpiCriterion {
  id: string;
  name: string;
  /** Percentage weight; the three weights sum to 100. */
  weight: number;
}

export const KPI_CRITERIA: KpiCriterion[] = [
  { id: "notifications", name: "Уведомления / долги", weight: 30 },
  { id: "csat", name: "CSAT", weight: 40 },
  { id: "service", name: "Чаты / Сервис", weight: 30 },
];

/** Quarterly-bonus gate (Условия tab): all three must hold. */
export const KPI_BONUS_THRESHOLDS = {
  service: 90, // Чаты/Сервис ≥ 90%
  notifications: 100, // 100% рассылок
  csat: 80, // CSAT ≥ 80%
} as const;

/**
 * Monthly KPI total 0..100. Each input is a percentage 0..100; a missing value
 * counts as 0 (matching the sheet, where an empty Чаты column lowers Итого).
 */
export function computeKpiScore(
  values: Record<string, number> = {},
  criteria: KpiCriterion[] = KPI_CRITERIA
): number {
  let total = 0;
  for (const c of criteria) {
    const raw = values[c.id];
    const pct =
      typeof raw === "number" && !Number.isNaN(raw)
        ? Math.max(0, Math.min(100, raw))
        : 0;
    total += (pct * c.weight) / 100;
  }
  return Math.round(total * 1000) / 1000;
}

/** Does the bookkeeper qualify for the 10% quarterly bonus? */
export function kpiBonusEligible(values: Record<string, number> = {}): boolean {
  return (
    (values.service ?? 0) >= KPI_BONUS_THRESHOLDS.service &&
    (values.notifications ?? 0) >= KPI_BONUS_THRESHOLDS.notifications &&
    (values.csat ?? 0) >= KPI_BONUS_THRESHOLDS.csat
  );
}

// --- Quality-control monthly assessment (КК — Контроль качества) -----------
//
// "ОЦЕНКА КАЧЕСТВА РАБОТЫ БУХГАЛТЕРА" (Margarita's КК сопровождение journal):
// five weighted criteria, each entered 0..100, Итог = Σ(Кᵢ × Wᵢ). Verified
// against her journal (20/80/90/100/100 → 84; 100/80/100/100/100 → 94). The
// weights are her «Гайд» Wi values (0.1 / 0.3 / 0.2 / 0.3 / 0.1) as percentages.

export const KK_CRITERIA: KpiCriterion[] = [
  { id: "errors", name: "Количество и уровень ошибок", weight: 10 },
  { id: "deadlines", name: "Соблюдение сроков выполнения задач", weight: 30 },
  { id: "reporting", name: "Качество подготовки отчётности", weight: 20 },
  { id: "documents", name: "Полнота и корректность документов", weight: 30 },
  { id: "rework", name: "Количество доработок после проверки", weight: 10 },
];

/** Итог 0..100 — weighted average of the five КК criteria (same maths as KPI). */
export function computeKkScore(
  values: Record<string, number> = {},
  criteria: KpiCriterion[] = KK_CRITERIA
): number {
  return computeKpiScore(values, criteria);
}

export interface KkLevel {
  /** Lower bound on the 0..100 Итог (her 1–5 thresholds, ×20). */
  min: number;
  action: string;
}

/** Action levels from her «ШКАЛА ИТОГОВОЙ ОЦЕНКИ» (1–5 scale, here on 0..100). */
export const KK_LEVELS: KkLevel[] = [
  { min: 90, action: "Премирование, кадровый резерв" }, // 4.50–5.00
  { min: 70, action: "План развития по слабым зонам" }, // 3.50–4.49
  { min: 50, action: "План корректирующих мероприятий" }, // 2.50–3.49
  { min: 0, action: "Административные меры / доп. обучение" }, // 1.00–2.49
];

/** The action level for a КК Итог score (0..100). */
export function kkLevel(score: number): KkLevel {
  for (const l of KK_LEVELS) if (score >= l.min) return l;
  return KK_LEVELS[KK_LEVELS.length - 1];
}

// --- Week helpers (registration journal is per-manager, per-week) -----------

/** ISO date (YYYY-MM-DD) of the Monday of the week containing `iso`. */
export function mondayOf(iso: string): string {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const day = d.getUTCDay(); // 0=Sun … 6=Sat
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}

/** ISO-8601 week label, e.g. "2026-W25", for the week containing `iso`. */
export function isoWeekLabel(iso: string): string {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  // Move to the Thursday of this week — its year owns the ISO week number.
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
  const year = d.getUTCFullYear();
  // Thursday of ISO week 1 (the week containing Jan 4).
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  firstThursday.setUTCDate(
    firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3
  );
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / 604_800_000);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

// --- Working-day helpers (daily QA "Активные за день" buckets) ---------------
//
// QA isn't done on non-working days, so a chat that was active on a weekend or
// an RA public holiday is reviewed together on the NEXT working day (e.g. a
// Saturday/Sunday chat shows up under Monday's checks). See reviewDayOf.

/**
 * Republic of Armenia public (non-working) holidays, as fixed MM-DD strings
 * (RA Labour Code, Art. 16). Armenia does NOT shift these for weekends, and
 * they're all fixed-date (Armenian Christmas is Jan 6, not movable Easter), so
 * a static MM-DD list is exact. Edit here as the official calendar changes.
 */
export const ARMENIAN_HOLIDAYS_MMDD: ReadonlySet<string> = new Set([
  "01-01", // Новый год
  "01-02", // Новый год
  "01-06", // Рождество (Армянская апостольская церковь)
  "01-28", // День армии
  "03-08", // Международный женский день
  "04-24", // День памяти жертв геноцида армян
  "05-01", // День труда
  "05-09", // День Победы и мира
  "05-28", // День Первой Республики
  "07-05", // День Конституции
  "09-21", // День независимости
  "12-31", // Канун Нового года
]);

/** True when `iso` (YYYY-MM-DD) is a Saturday, Sunday, or RA public holiday. */
export function isNonWorkingDay(iso: string): boolean {
  const ymd = iso.slice(0, 10);
  const d = new Date(ymd + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return false;
  const day = d.getUTCDay(); // 0=Sun … 6=Sat
  if (day === 0 || day === 6) return true;
  return ARMENIAN_HOLIDAYS_MMDD.has(ymd.slice(5)); // "MM-DD"
}

/**
 * The QA review day for activity that happened on `iso`: the same day if it's a
 * working day, otherwise the next working day (skipping weekends + holidays).
 * Weekend/holiday activity is reviewed together on the next working day, so e.g.
 * Sat+Sun roll onto Monday. Capped at 14 forward steps as a safety guard.
 */
export function reviewDayOf(iso: string): string {
  let cur = iso.slice(0, 10);
  if (Number.isNaN(new Date(cur + "T00:00:00Z").getTime())) return cur;
  for (let i = 0; i < 14 && isNonWorkingDay(cur); i++) {
    const d = new Date(cur + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    cur = d.toISOString().slice(0, 10);
  }
  return cur;
}
