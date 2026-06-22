// ---------------------------------------------------------------------------
// Keyword-based mailing detector for Russian-language accountant messages.
//
// Maps a message text to a list of (category, status, priority) signals.
// Each rule fires when ALL its required patterns match (case-insensitive).
// Where two rules match the same category, the one with higher priority wins.
//
// Used both by the TypeScript API route (/api/mailings/detect) and as a
// reference spec — the SQL function in the migration mirrors these patterns.
// ---------------------------------------------------------------------------

export interface MailingSignal {
  category: "main_taxes" | "salary" | "primary_docs" | "debts";
  status: string;
  /** Higher = take this status over a lower-priority one for the same category. */
  priority: number;
}

interface Rule {
  category: MailingSignal["category"];
  status: string;
  priority: number;
  /** All regex must match the message (AND logic). */
  all: RegExp[];
}

const RULES: Rule[] = [
  // --- main_taxes -----------------------------------------------------------
  {
    category: "main_taxes",
    status: "Отправил",
    priority: 20,
    all: [
      /(налог|декларац|ндс|налогов)/i,
      /(отправ|подан|сдан|направил|загрузил|выгрузил|сдала|отправила)/i,
    ],
  },

  // --- salary ---------------------------------------------------------------
  {
    category: "salary",
    status: "Получил",
    priority: 20,
    all: [
      /(зарплат|ведомост|\bзп\b|авансовый\s+отчет|авансов)/i,
      /(получ|пришл|прислал|подпис|сдал|предоставил|скинул|сбросил|прислала|получила|пришла)/i,
    ],
  },
  {
    category: "salary",
    status: "Запросил 1, не получил",
    priority: 10,
    all: [
      /(зарплат|ведомост|\bзп\b)/i,
      /(запрос|прошу|просьб|нужн|пришлит|отправьт|скиньт|передайт|пожалуйст)/i,
    ],
  },

  // --- primary_docs ---------------------------------------------------------
  {
    category: "primary_docs",
    status: "Получил",
    priority: 20,
    all: [
      /(первичн|первичк|акт[ыа]?\b|документ|накладн|счет-факт|счёт-факт)/i,
      /(получ|пришл|прислал|сдал|предоставил|скинул|передал|прислала|получила|пришла)/i,
    ],
  },
  {
    category: "primary_docs",
    status: "Запросил 1, не получил",
    priority: 10,
    all: [
      /(первичн|первичк|акт[ыа]?\b|документ|накладн)/i,
      /(запрос|прошу|просьб|нужн|пришлит|отправьт|скиньт|передайт|пожалуйст)/i,
    ],
  },

  // --- debts ----------------------------------------------------------------
  {
    category: "debts",
    status: "1-й позвонил",
    priority: 20,
    all: [
      /(долг|задолженност)/i,
      /(позвон|звонил|звонок|обзвон|перезвон)/i,
    ],
  },
  {
    category: "debts",
    status: "1-й написал",
    priority: 10,
    all: [
      /(долг|задолженност)/i,
      /(написал|написала|напоминани|уведомил|сообщил|написали|напомнил)/i,
    ],
  },
];

/** Classify a single message text. Returns one signal per matching category (highest priority). */
export function detectMailings(text: string): MailingSignal[] {
  if (!text || text.length < 4) return [];

  const best = new Map<MailingSignal["category"], MailingSignal>();
  for (const rule of RULES) {
    if (!rule.all.every((re) => re.test(text))) continue;
    const prev = best.get(rule.category);
    if (!prev || rule.priority > prev.priority) {
      best.set(rule.category, {
        category: rule.category,
        status: rule.status,
        priority: rule.priority,
      });
    }
  }
  return [...best.values()];
}
