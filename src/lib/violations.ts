import { mondayOf } from "./scoring";

// Config for the "Нарушения" log (item 6). Derived from the "Нарушения",
// "Списки" and "Условия" tabs of Margarita's spreadsheets. Free text is allowed
// everywhere; these lists just drive the dropdowns.
export const VIOLATION_SEVERITIES = ["Среднее", "Критичное", "Грубое"] as const;

// Сервисные нарушения — full vocabulary migrated from the "Списки" / "Условия"
// tabs (service-quality / communication issues).
export const VIOLATION_TYPES = [
  "Долгий ответ",
  "Грубый ответ",
  "Игнорирование задач",
  "Тегать коллег без описания",
  "Нет расс. по Долгу",
  "Нет расс. по ЗП",
  "Нет расс. по Отчетам",
  "Нет расс. по первичной документации",
  "Некорректные или неполные консультации",
  "Отсутствие письменной фиксации договоренностей",
  "Отсутствие фиксации звонков через чат",
  "Несвоевременная обратная связь по задачам",
  "Повторные вопросы клиента по одному и тому же вопросу",
  "Грубость или некорректный тон общения",
  "Односложные ответы без пояснений",
  "Отсутствие проверки понимания клиентом ответа",
  "Некорректная коммуникация внутри команды",
  "Нарушение обещанных сроков ответа",
  "Отсутствие обозначения сроков выполнения задачи",
  "Незакрытый запрос клиента, ощущения незавершенной работы",
  "Ошибка в отправленном инвойсе",
  "Не отработаны замечания и жалобы клиента",
  "Отправил сообщение о задолженности не в тот чат",
  "Другое",
] as const;

// Грубые нарушения — full "Грубые нарушения" list from the "Списки" tab.
export const GROSS_VIOLATION_TYPES = [
  "Просрочка отчетности",
  "Неверный расчет отчетности",
  "Клиент получил неверную сумму налога",
  "Клиент не предупрежден о платеже (не наши платежи)",
  "Неправильный выбор системы налогообложения",
  "Незарегистрированные обязательные сотрудники в ООО или ИП",
  "Не учли превышение лимита",
  "Не проверен личный кабинет клиента",
  "Не отреагировали на запрос от налоговой",
  "Не подготовили пояснения для налоговой",
  "Несвоевременное оформление ПКО/РКО",
  "Несоответствие остатков",
  "Использование информации клиента в личных целях",
  "Заметил ошибку и не сообщил",
  "Пытался «замять» ситуацию",
  "Переложил ответственность",
  "Отказ обслуживать клиента",
  "Отсутствие на связи в отчетный период без предупреждения",
  "Другое (грубое)",
] as const;

/** All violation-type suggestions for a given severity. */
export function violationTypeOptions(severity?: string): readonly string[] {
  if (severity === "Грубое") return GROSS_VIOLATION_TYPES;
  return VIOLATION_TYPES;
}

// --- Sanction reference tables (Условия / Памятка) --------------------------
// Migrated so the money side of QA lives in the platform too. Plain data,
// rendered read-only on the /handbook page.

export interface SanctionRule {
  /** What triggers the sanction. */
  trigger: string;
  /** Escalation steps (1st / 2nd / 3rd … occurrence). */
  steps: string[];
  note?: string;
}

export const SANCTION_RULES: SanctionRule[] = [
  {
    trigger: "Плохой сервис / чаты, неотправленные уведомления",
    steps: [
      "1 за неделю — предупреждение",
      "2 и более за неделю — 1 000 др. за каждый чат",
    ],
    note: "Оценка Маргариты: коммуникация, отправка долгов, отчётов и уведомлений.",
  },
  {
    trigger: "Критичный сервис / чаты",
    steps: ["2 000 др. за каждый случай"],
  },
  {
    trigger: "Грубые нарушения",
    steps: [
      "1 за год — предупреждение",
      "2 — 10 000 др.",
      "3 — 30 000 др.",
    ],
  },
  {
    trigger: "Штрафы у клиентов",
    steps: [
      "1 за год — предупреждение",
      "2 — 5% от оклада",
      "3 — 10% от оклада",
      "4 — увольнение",
    ],
    note: "Каждый случай разбирается: вина бухгалтера или клиента.",
  },
  {
    trigger: "Уход клиента из-за грубого нарушения",
    steps: ["1 за год — 5% оклада", "2 — 10% оклада", "3 — увольнение"],
  },
  {
    trigger: "Увод клиентов",
    steps: ["1 000 000 др."],
  },
  {
    trigger: "Увольнение без передачи дел",
    steps: ["Задержка окончательного расчёта до момента надлежащей передачи дел"],
  },
  {
    trigger: "Не перевели клиента на нужную систему налогообложения",
    steps: [
      "1 замечание — 5% от 12 месяцев оплаты клиента",
      "2 замечание — 10% от 12 месяцев оплаты клиента",
      "3 замечание — 25% от 12 месяцев оплаты клиента",
    ],
    note: "Если клиент отказался от наших услуг из-за грубого нарушения.",
  },
  {
    trigger: "Подделка документов",
    steps: ["Увольнение одним днём"],
  },
  {
    trigger: "Использование данных клиента в личных целях",
    steps: ["Увольнение одним днём"],
  },
  {
    trigger: "Разглашение конфиденциальной информации",
    steps: ["Штраф 100 000 др."],
    note: "Конфиденциальная информация: обороты, маржинальность, прибыль, ФОТ, себестоимость услуг, структура доходов, регламенты, чек-листы, шаблоны отчётности, скрипты коммуникации, CRM-структура, зарплаты сотрудников, бонусная система, конфликты и дисциплинарные меры, решения по клиентам, система KPI и бонусов, движение денежных средств клиентов, контрагенты/контракты/условия сделок/ценообразование/схемы работы клиентов.",
  },
];

/** Hard cap: total monthly sanctions cannot exceed this share of salary. */
export const SANCTION_CAP_PCT = 30;

// --- Rule-based fine amounts (драм) — from the «Условия» sheet --------------

/** Среднее: 2+ per accountant per week → 1 000 др за КАЖДЫЙ чат. */
export const MEDIUM_FINE = 1_000;
/** Критичный сервис / чаты: 2 000 др за каждый случай. */
export const CRITICAL_FINE = 2_000;
/** Грубые: 1-е за год — предупреждение, 2-е — 10 000, 3-е и далее — 30 000. */
export const GROSS_FINES = [0, 10_000, 30_000] as const;

/** The slice of a Violation the fine computation needs. */
export interface FineViolation {
  vdate: string;
  accountant: string | null;
  severity: string | null;
  /** Manual sanction — when set (> 0) it overrides the computed amount. */
  sanction: number | null;
}

/**
 * Compute the fine (драм) for every violation per the «Условия» rules:
 *   • Среднее   — 1 за неделю → предупреждение (0 др); 2 и более за неделю
 *                 (per accountant) → 1 000 др за каждый чат
 *   • Критичное — 2 000 др за каждый случай
 *   • Грубое    — 1-е за год → предупреждение; 2-е → 10 000; 3-е+ → 30 000
 *                 (per accountant; `grossPrior` = this-year count BEFORE the
 *                 window covered by `violations`, so escalation carries over)
 * A manually-entered sanction (> 0) always wins over the computed amount.
 * Returns amounts aligned with the input order.
 */
export function computeViolationFines(
  violations: FineViolation[],
  options: { grossPrior?: Record<string, number> } = {}
): number[] {
  const { grossPrior = {} } = options;

  // Среднее count per (accountant, week) — the "2 и более за неделю" rule.
  const mediumPerAccWeek = new Map<string, number>();
  const accWeekKey = (v: FineViolation) =>
    `${v.accountant ?? ""}|${mondayOf(v.vdate)}`;
  const sevOf = (v: FineViolation) => (v.severity ?? "среднее").toLowerCase();
  for (const v of violations) {
    const sev = sevOf(v);
    if (!sev.includes("критич") && !sev.includes("груб")) {
      const key = accWeekKey(v);
      mediumPerAccWeek.set(key, (mediumPerAccWeek.get(key) ?? 0) + 1);
    }
  }

  // Gross escalation index per accountant, in date order across the window.
  const grossSeen = new Map<string, number>();
  const grossOrder = violations
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => sevOf(v).includes("груб"))
    .sort((a, b) => a.v.vdate.localeCompare(b.v.vdate) || a.i - b.i);
  const grossFineByIndex = new Map<number, number>();
  for (const { v, i } of grossOrder) {
    const acc = v.accountant ?? "";
    const nth = (grossPrior[acc] ?? 0) + (grossSeen.get(acc) ?? 0) + 1;
    grossSeen.set(acc, (grossSeen.get(acc) ?? 0) + 1);
    grossFineByIndex.set(i, GROSS_FINES[Math.min(nth, GROSS_FINES.length) - 1]);
  }

  return violations.map((v, i) => {
    if (typeof v.sanction === "number" && v.sanction > 0) return v.sanction;
    const sev = sevOf(v);
    if (sev.includes("груб")) return grossFineByIndex.get(i) ?? 0;
    if (sev.includes("критич")) return CRITICAL_FINE;
    return (mediumPerAccWeek.get(accWeekKey(v)) ?? 0) >= 2 ? MEDIUM_FINE : 0;
  });
}
