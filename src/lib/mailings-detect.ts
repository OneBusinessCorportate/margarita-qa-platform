// ---------------------------------------------------------------------------
// Keyword-based mailing detector for Russian-language accountant messages.
//
// Each rule tags a message with a signal TYPE — the API route counts signals
// per (chat, category, type) across all messages in a period to derive the
// correct graduated status ("Запросил 2" after two requests, "2-й написал"
// after two debt follow-ups, etc.).
// ---------------------------------------------------------------------------

/**
 * Signal type tags — describe what the accountant did in the message:
 *   done  — completed the action (sent taxes, received docs, received salary)
 *   req   — made a request / wrote the client (asked for docs, wrote about debt)
 *   call  — made a phone call (called about debt)
 *   paid  — client paid the debt (no debt remaining)
 */
export type SignalType = "done" | "req" | "call" | "paid";

export interface MailingSignal {
  category: "main_taxes" | "salary" | "primary_docs" | "debts";
  type: SignalType;
}

interface Rule {
  category: MailingSignal["category"];
  type: SignalType;
  all: RegExp[];
}

const RULES: Rule[] = [
  // --- main_taxes -----------------------------------------------------------
  {
    category: "main_taxes",
    type: "done",
    all: [
      /(налог|декларац|ндс|налогов)/i,
      /(отправ|подан|сдан|направил|загрузил|выгрузил|сдала|отправила)/i,
    ],
  },

  // --- salary ---------------------------------------------------------------
  {
    category: "salary",
    type: "done",
    all: [
      /(зарплат|ведомост|\bзп\b|авансовый\s+отчет|авансов)/i,
      /(получ|пришл|прислал|подпис|сдал|предоставил|скинул|сбросил|прислала|получила|пришла)/i,
    ],
  },
  {
    category: "salary",
    type: "req",
    all: [
      /(зарплат|ведомост|\bзп\b)/i,
      /(запрос|прошу|просьб|нужн|пришлит|отправьт|скиньт|передайт|пожалуйст)/i,
    ],
  },

  // --- primary_docs ---------------------------------------------------------
  {
    category: "primary_docs",
    type: "done",
    all: [
      /(первичн|первичк|акт[ыа]?\b|документ|накладн|счет-факт|счёт-факт)/i,
      /(получ|пришл|прислал|сдал|предоставил|скинул|передал|прислала|получила|пришла)/i,
    ],
  },
  {
    category: "primary_docs",
    type: "req",
    all: [
      /(первичн|первичк|акт[ыа]?\b|документ|накладн)/i,
      /(запрос|прошу|просьб|нужн|пришлит|отправьт|скиньт|передайт|пожалуйст)/i,
    ],
  },

  // --- debts ----------------------------------------------------------------
  {
    category: "debts",
    type: "paid",
    all: [
      /(долг|задолженност|задолж)/i,
      /(оплатил|оплатила|оплата\s+прошла|погашен|погасил|закрыт|закрыта|нет\s+долга|нет\s+задолж)/i,
    ],
  },
  {
    category: "debts",
    type: "call",
    all: [
      /(долг|задолженност)/i,
      /(позвон|звонил|звонок|обзвон|перезвон)/i,
    ],
  },
  {
    category: "debts",
    type: "req",
    all: [
      /(долг|задолженност)/i,
      /(написал|написала|напоминани|уведомил|сообщил|написали|напомнил)/i,
    ],
  },
];

/** All signals fired by a single message (may be several categories). */
export function detectAllSignals(text: string): MailingSignal[] {
  if (!text || text.length < 4) return [];
  const out: MailingSignal[] = [];
  for (const rule of RULES) {
    if (rule.all.every((re) => re.test(text))) {
      out.push({ category: rule.category, type: rule.type });
    }
  }
  return out;
}

/**
 * Derive the final mailing status for a category from accumulated signal
 * counts across all messages in a period. Call this after counting signals
 * from every message.
 */
export function deriveStatus(
  category: string,
  counts: { done: number; req: number; call: number; paid: number }
): string | null {
  switch (category) {
    case "main_taxes":
      return counts.done >= 1 ? "Отправил" : null;

    case "salary":
      if (counts.done >= 1) return "Получил";
      if (counts.req >= 2) return "Запросил 2, не получил";
      if (counts.req === 1) return "Запросил 1, не получил";
      return null;

    case "primary_docs":
      if (counts.done >= 1) return "Получил";
      if (counts.req >= 2) return "Запросил 2, не получил";
      if (counts.req === 1) return "Запросил 1, не получил";
      return null;

    case "debts":
      if (counts.paid >= 1) return "Нет долга";
      if (counts.call >= 1) return "1-й позвонил";
      if (counts.req >= 2) return "2-й написал";
      if (counts.req === 1) return "1-й написал";
      return null;

    default:
      return null;
  }
}
