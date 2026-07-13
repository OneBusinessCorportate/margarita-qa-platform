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

/**
 * All violation-type suggestions to offer in the dropdown. Every reason must be
 * reachable regardless of the chosen severity (Маргарита: «не отображаются все
 * варианты причин»), so we always return the FULL vocabulary — service +
 * gross — de-duplicated. Only the ORDER changes with severity: for «Грубое» the
 * gross reasons come first, otherwise the service reasons come first.
 */
export function violationTypeOptions(severity?: string): readonly string[] {
  const service = VIOLATION_TYPES;
  const gross = GROSS_VIOLATION_TYPES;
  const ordered =
    severity === "Грубое" ? [...gross, ...service] : [...service, ...gross];
  // De-duplicate while preserving order (e.g. a shared "Другое"-style entry).
  return [...new Set(ordered)];
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
      "1-е нарушение за день — предупреждение",
      "2-е и последующие за тот же день — 1 000 др. за каждое",
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
//
// The unit of a «нарушение» is a CHAT, not a single problem line: «2 и более
// за неделю — 1 000 др. за КАЖДЫЙ чат». So several problems logged against the
// same chat (by the same bookkeeper, in the same week) are ONE нарушение — its
// severity is the worst of them, and it is fined once. That single rule is used
// everywhere (fines AND the counts shown in the reports), so the money and the
// «N нарушений» always agree with the «Условия» sheet.

/** Стандартный сервис: 1-е нарушение за день — предупреждение, каждое
 *  последующее за тот же день — 1 000 др. */
export const MEDIUM_FINE = 1_000;
/** Критичный сервис / чаты: 2 000 др за каждый чат. */
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
  /** Chat / contract code (B-4066 …) — the primary key for «за каждый чат». */
  chat_agr_no?: string | null;
  /** Client / chat name — fallback chat identity when there is no code. */
  client?: string | null;
  /** Problem description — merged into the нарушение's reason text. */
  violation_type?: string | null;
}

/** Severity bucket that drives the «Условия» pricing. */
export type ViolationClass = "standard" | "critical" | "gross";
const CLASS_RANK: Record<ViolationClass, number> = {
  standard: 0,
  critical: 1,
  gross: 2,
};
const CLASS_LABEL: Record<ViolationClass, string> = {
  standard: "Среднее",
  critical: "Критичное",
  gross: "Грубое",
};

/** Классификация тяжести: грубое > критичное > (всё остальное) стандартное. */
export function violationClassOf(
  severity: string | null | undefined
): ViolationClass {
  const s = (severity ?? "").toLowerCase();
  if (s.includes("груб")) return "gross";
  if (s.includes("критич")) return "critical";
  return "standard";
}

/**
 * Chat identity used to collapse problems into one нарушение. Rows with neither
 * a code nor a client name can't be merged, so each stays its own нарушение.
 */
function chatKeyOf(v: FineViolation, idx: number): string {
  const code = (v.chat_agr_no ?? "").trim().toLowerCase();
  if (code) return `c:${code}`;
  const client = (v.client ?? "").trim().toLowerCase();
  if (client) return `n:${client}`;
  return `#${idx}`;
}

/** One нарушение = one chat, one bookkeeper, one week (worst severity, fined once). */
export interface Narushenie {
  accountant: string;
  chat_agr_no: string | null;
  client: string | null;
  /** Earliest problem date in the group. */
  vdate: string;
  /** ISO Monday of `vdate`. */
  week: string;
  /** Worst severity bucket among the group's problems. */
  klass: ViolationClass;
  /** Canonical Russian severity label (Среднее / Критичное / Грубое). */
  severity: string;
  /** Distinct problem descriptions, in first-seen order. */
  types: string[];
  /** Fine (драм) per «Условия». */
  fine: number;
  /** Input rows in this нарушение, representative (earliest) first. */
  rowIndexes: number[];
  /** Priced by a manual sanction rather than the rules. */
  manual: boolean;
}

/**
 * Collapse raw violation rows into нарушения and price each per «Условия»:
 *   • Стандартное (Среднее) — эскалация ПО ДНЯМ: 1-е нарушение за день →
 *     предупреждение (0 др); каждое последующее за ТОТ ЖЕ день (на бухгалтера)
 *     → 1 000 др
 *   • Критичное — 2 000 др за каждый чат
 *   • Грубое    — 1-е за год → предупреждение; 2-е → 10 000; 3-е+ → 30 000
 *     (`grossPrior` = this-year нарушения count BEFORE the window, so the
 *     escalation carries over)
 * Several problems in the SAME chat (same bookkeeper, same day) are ONE
 * нарушение — worst severity, fined once. A manual sanction (> 0) prices its
 * own row explicitly and is never merged away.
 */
export function groupNarusheniya(
  violations: FineViolation[],
  options: { grossPrior?: Record<string, number> } = {}
): Narushenie[] {
  const { grossPrior = {} } = options;

  interface Acc {
    accountant: string;
    chat_agr_no: string | null;
    client: string | null;
    vdate: string;
    klass: ViolationClass;
    types: string[];
    rowIndexes: number[];
    rep: number;
    manualSanction: number | null;
  }
  const groups = new Map<string, Acc>();
  const order: string[] = []; // stable, first-seen output order

  violations.forEach((v, i) => {
    const accountant = v.accountant ?? "";
    const day = (v.vdate ?? "").slice(0, 10);
    const manual = typeof v.sanction === "number" && v.sanction > 0;
    // Manually-priced rows never merge (their amount must survive verbatim).
    // Grouping is PER DAY (was per week): several problems in one chat on the
    // same day are one нарушение; different days are different нарушения.
    const key = manual ? `manual#${i}` : `${accountant}|${day}|${chatKeyOf(v, i)}`;
    const klass = violationClassOf(v.severity);
    const type = (v.violation_type ?? "").trim();
    const g = groups.get(key);
    if (!g) {
      groups.set(key, {
        accountant,
        chat_agr_no: v.chat_agr_no ?? null,
        client: v.client ?? null,
        vdate: v.vdate,
        klass,
        types: type ? [type] : [],
        rowIndexes: [i],
        rep: i,
        manualSanction: manual ? (v.sanction as number) : null,
      });
      order.push(key);
    } else {
      g.rowIndexes.push(i);
      if (CLASS_RANK[klass] > CLASS_RANK[g.klass]) g.klass = klass;
      if (type && !g.types.includes(type)) g.types.push(type);
      if (v.vdate < g.vdate || (v.vdate === g.vdate && i < g.rep)) {
        g.vdate = v.vdate;
        g.rep = i;
      }
      if (!g.chat_agr_no && v.chat_agr_no) g.chat_agr_no = v.chat_agr_no;
      if (!g.client && v.client) g.client = v.client;
    }
  });

  const list = order.map((k) => groups.get(k)!);

  // Standard DAILY escalation: the 1st standard нарушение per bookkeeper per DAY
  // is only a warning (0 др); every subsequent нарушение that SAME day is
  // 1 000 др. `list` is in first-seen order, so the first one we meet for an
  // (accountant, day) pair is the warning.
  const stdSeenPerAccDay = new Map<string, number>();
  const stdFineOf = new Map<Acc, number>();
  for (const g of list) {
    if (g.manualSanction != null || g.klass !== "standard") continue;
    const k = `${g.accountant}|${g.vdate.slice(0, 10)}`;
    const seen = stdSeenPerAccDay.get(k) ?? 0;
    stdFineOf.set(g, seen >= 1 ? MEDIUM_FINE : 0);
    stdSeenPerAccDay.set(k, seen + 1);
  }

  // Gross per-year escalation per bookkeeper, counted in date order.
  const grossSeen: Record<string, number> = {};
  const grossFineOf = new Map<Acc, number>();
  const grossGroups = list
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => g.manualSanction == null && g.klass === "gross")
    .sort((a, b) => a.g.vdate.localeCompare(b.g.vdate) || a.i - b.i);
  for (const { g } of grossGroups) {
    const nth = (grossPrior[g.accountant] ?? 0) + (grossSeen[g.accountant] ?? 0) + 1;
    grossSeen[g.accountant] = (grossSeen[g.accountant] ?? 0) + 1;
    grossFineOf.set(g, GROSS_FINES[Math.min(nth, GROSS_FINES.length) - 1]);
  }

  return list.map((g) => {
    let fine: number;
    if (g.manualSanction != null) fine = g.manualSanction;
    else if (g.klass === "gross") fine = grossFineOf.get(g) ?? 0;
    else if (g.klass === "critical") fine = CRITICAL_FINE;
    else fine = stdFineOf.get(g) ?? 0;
    return {
      accountant: g.accountant,
      chat_agr_no: g.chat_agr_no,
      client: g.client,
      vdate: g.vdate,
      week: mondayOf(g.vdate),
      klass: g.klass,
      severity: CLASS_LABEL[g.klass],
      types: g.types,
      fine,
      rowIndexes: [g.rep, ...g.rowIndexes.filter((x) => x !== g.rep)],
      manual: g.manualSanction != null,
    };
  });
}

/**
 * Per-row fines aligned with the input order. Each нарушение's amount lands on
 * its representative row (the earliest problem in that chat/week); the other
 * rows of the same нарушение get 0, so a chat with several problems is charged
 * ONCE. See groupNarusheniya for the «Условия» rules.
 */
export function computeViolationFines(
  violations: FineViolation[],
  options: { grossPrior?: Record<string, number> } = {}
): number[] {
  const out = new Array<number>(violations.length).fill(0);
  for (const n of groupNarusheniya(violations, options)) {
    out[n.rowIndexes[0]] = n.fine;
  }
  return out;
}
