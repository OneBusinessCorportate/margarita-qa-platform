// ---------------------------------------------------------------------------
// Регламент / справочник — reference data migrated from Margarita's three
// spreadsheets (Бухгалтерия + Регистрационный отдел). Pure DATA, rendered
// read-only on the /handbook page so every grade, bonus and point system lives
// in the platform alongside the scoring.
// ---------------------------------------------------------------------------

export interface Grade {
  name: string;
  /** Monthly base salary in драм. */
  salary: number;
  /** Time-in-grade guideline. */
  tenure?: string;
  /** Max KPI bonus in драм (+), if a fixed figure applies. */
  kpiBonus?: number;
  /** Max monthly penalty in драм (−). */
  penalty?: number;
  note?: string;
}

export interface GradeLadder {
  department: string;
  /** How often the grade is reviewed. */
  review: string;
  grades: Grade[];
  basis: string[];
}

export const GRADE_LADDERS: GradeLadder[] = [
  {
    department: "Бухгалтерия",
    review: "Пересмотр грейда раз в полгода",
    basis: [
      "Посещение обучений — не менее 80%",
      "Результаты тестирования",
      "Аудит работы: НДС — ежемесячно, УСН — ежеквартально",
      "Отсутствие штрафов согласно регламенту (факультативно)",
    ],
    grades: [
      { name: "Счетовод", salary: 150_000, tenure: "Полгода" },
      { name: "Младший бухгалтер", salary: 250_000 },
      { name: "Бухгалтер", salary: 350_000 },
      { name: "Ведущий бухгалтер", salary: 400_000 },
      { name: "Тимлид", salary: 0, note: "Оклад по договорённости" },
    ],
  },
  {
    department: "Регистрационный отдел",
    review: "Переход по компетенциям (срок — минимальное условие)",
    basis: [
      "Оси роста: Знания / Результат / Масштаб / Влияние",
      "Демонстрация компетенций следующего уровня",
    ],
    grades: [
      {
        name: "Специалист I",
        salary: 150_000,
        tenure: "0–2 мес.",
        kpiBonus: 50_000,
        penalty: -30_000,
        note: "ОС клиентов + отсутствие отказов банка/регистра",
      },
      {
        name: "Специалист II",
        salary: 200_000,
        tenure: "2–6 мес.",
        kpiBonus: 50_000,
        penalty: -30_000,
        note: "ОС клиентов + отсутствие отказов банка/регистра",
      },
      {
        name: "Старший специалист I",
        salary: 300_000,
        tenure: "6–12 мес.",
        kpiBonus: 50_000,
        penalty: -42_000,
        note: "Отсутствие ошибок",
      },
      {
        name: "Старший специалист II",
        salary: 450_000,
        tenure: "1+ лет",
        penalty: -54_000,
        note: "Ноль критических ошибок",
      },
    ],
  },
];

// --- Bonuses & incentives ---------------------------------------------------

export interface BonusRule {
  name: string;
  amount: string;
  period: string;
  conditions: string[];
}

export const BONUS_RULES: BonusRule[] = [
  {
    name: "Квартальный бонус (Бухгалтерия)",
    amount: "10% от оклада",
    period: "Ежеквартально",
    conditions: [
      "Чаты / Сервис ≥ 90%",
      "Уведомления и долги — 100% рассылок",
      "CSAT ≥ 80% (минимум 30% клиентов отвечают)",
      "48 часов на отработку кризиса при недовольстве клиента",
    ],
  },
  {
    name: "Индексация зарплаты",
    amount: "до 5% в год",
    period: "Год",
    conditions: [
      "Автоматическая ежегодная индексация",
      "Не более 20% от бюджета закреплённых клиентов",
    ],
  },
  {
    name: "Бонус за UPSALE (Регистрация)",
    amount: "5% от суммы сделки",
    period: "За оплаченную услугу",
    conditions: [
      "Выявить потребность → заполнить карточку → отдел продаж закрывает сделку",
      "Средний KPI за месяц ≥ 80 баллов",
      "Критических ошибок ≤ 2",
    ],
  },
];

export interface StarRule {
  name: string;
  reward: string;
  condition: string;
}

export const STAR_RULES: StarRule[] = [
  { name: "Звезда дня", reward: "Звезда дня", condition: "Сервис > 95%" },
  { name: "Звезда недели", reward: "Торт / Пиво", condition: "5 звёзд дня" },
  { name: "Звезда месяца", reward: "Day Off", condition: "2 звезды недели / 10 звёзд" },
];

// --- Critical errors (Регистрационный отдел) --------------------------------
// These hit the KPI bonus (variable pay), separate from the weekly point score.

export interface CriticalErrorRule {
  error: string;
  penalty: string;
}

export const CRITICAL_ERROR_RULES: CriticalErrorRule[] = [
  { error: "Ошибка в документе клиенту или в госорган", penalty: "−100% KPI бонуса за месяц" },
  { error: "Отказ банка или регистра по вине специалиста", penalty: "−100% KPI бонуса за месяц" },
  { error: "Не ответил клиенту более 1 часа без предупреждения", penalty: "−50% KPI бонуса за месяц" },
  { error: "Дал клиенту неверную информацию", penalty: "−100% KPI бонуса за месяц" },
  { error: "Потеря документов или данных клиента", penalty: "−100% KPI бонуса за месяц" },
];

export interface CriticalAccumulationRow {
  count: string;
  junior: string;
  senior: string;
}

/** Накопительная система критических ошибок по грейдам. */
export const CRITICAL_ACCUMULATION: CriticalAccumulationRow[] = [
  {
    count: "1 ошибка",
    junior: "Потеря 50% бонуса + личный разбор",
    senior: "Потеря 100% бонуса + письменное предупреждение",
  },
  {
    count: "2 ошибки",
    junior: "Потеря 100% бонуса + письменное предупреждение",
    senior: "Потеря 100% бонуса + пересмотр грейда",
  },
  {
    count: "3+ ошибки",
    junior: "Возврат на испытательный срок",
    senior: "Понижение грейда",
  },
];

export function fmtDram(n: number): string {
  if (!n) return "—";
  return n.toLocaleString("ru-RU") + " др.";
}
