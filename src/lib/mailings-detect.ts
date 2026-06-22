// ---------------------------------------------------------------------------
// Keyword-based mailing detector for Russian + Armenian accountant messages.
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
  // --- main_taxes (Russian) -------------------------------------------------
  {
    category: "main_taxes",
    type: "done",
    all: [
      /(налог|декларац|ндс|налогов)/i,
      /(отправ|подан|сдан|направил|загрузил|выгрузил|сдала|отправила)/i,
    ],
  },
  // --- main_taxes (Armenian) ------------------------------------------------
  // հարկ=tax, ԱԱՀ=VAT, հայտ=declaration, ուղարկ=sent, ներկայաց=submitted
  {
    category: "main_taxes",
    type: "done",
    all: [
      /(հարկ|ԱԱՀ|հայտ|հռչ|հաշվետ)/,
      /(ուղարկ|ներկայաց|հանձնե|բեռնե|ներբեռն)/,
    ],
  },

  // --- salary (Russian) -----------------------------------------------------
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
  // --- salary (Armenian) ----------------------------------------------------
  // աշխատավարձ=salary, հաշվետ=payroll, ստացական=receipt, ցուցակ=list
  {
    category: "salary",
    type: "done",
    all: [
      /(աշխատավարձ|աշխ\.?\s*վ|ա\/վ|ա\.վ\.|հաշվ\.?\s*ց|ռոճիկ)/,
      /(ստաց|ուղարկ|տրամ|ստ\.)/,
    ],
  },
  {
    category: "salary",
    type: "req",
    all: [
      /(աշխատավարձ|աշխ\.?\s*վ|ա\/վ|ռոճիկ)/,
      /(խնդրե|կարիք|պե՞տք)/,
    ],
  },

  // --- primary_docs (Russian) -----------------------------------------------
  {
    category: "primary_docs",
    type: "done",
    all: [
      // Use lookbehind+lookahead — JS \b is ASCII-only and doesn't work for Cyrillic
      /(первичн|первичк|(?<![а-яёА-ЯЁ])акт(?:ами|ах|ов|ом|ам|[ыауе])?(?![а-яёА-ЯЁ])|документ|накладн|счет-факт|счёт-факт)/i,
      /(получ|пришл|прислал|сдал|предоставил|скинул|передал|прислала|получила|пришла)/i,
    ],
  },
  {
    category: "primary_docs",
    type: "req",
    all: [
      /(первичн|первичк|(?<![а-яёА-ЯЁ])акт(?:ами|ах|ов|ом|ам|[ыауе])?(?![а-яёА-ЯЁ])|документ|накладн)/i,
      /(запрос|прошу|просьб|нужн|пришлит|отправьт|скиньт|передайт|пожалуйст)/i,
    ],
  },
  // --- primary_docs (Armenian) ----------------------------------------------
  // փաստաթ=document, [աՈ][կք]տ=act, հաշիվ=invoice; iu = Unicode case-fold
  {
    category: "primary_docs",
    type: "done",
    all: [
      /(փաստաթ|[աՈ][կք]տ|հաշիվ|[աՈ][կք]ներ|ն[եա]ր[կք]ա)/iu,
      /(ստաց|ուղարկ|հանձնե|ստ\.)/iu,
    ],
  },
  {
    category: "primary_docs",
    type: "req",
    all: [
      /(փաստաթ|[աՈ][կք]տ|հաշիվ)/iu,
      /(խնդրե|կարիք|պետք)/iu,
    ],
  },

  // --- debts (Russian) ------------------------------------------------------
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
  // --- debts (Armenian) — iu = Unicode case-fold handles sentence-start capitals
  // պարտք=debt, վճար=pay, զանգ=call, գր=wrote, հուշ=reminder
  {
    category: "debts",
    type: "paid",
    all: [
      /(պարտք|պարտաբ)/iu,
      /(վճար|մարե|փակե|չկա\s+պ|պարտք\s+չ)/iu,
    ],
  },
  {
    category: "debts",
    type: "call",
    all: [
      /(պարտք|պարտաբ)/iu,
      /(զանգ|զ\.)/iu,
    ],
  },
  {
    category: "debts",
    type: "req",
    all: [
      /(պարտք|պարտաբ)/iu,
      /(գր[եէ]|հուշ|տեղեկ|ծանուց)/iu,
    ],
  },
];

/** All signals fired by a single message (may be several categories). */
export function detectAllSignals(text: string): MailingSignal[] {
  if (!text || text.length < 4) return [];
  const out: MailingSignal[] = [];
  const seen = new Set<string>(); // deduplicate (category, type) pairs
  for (const rule of RULES) {
    if (rule.all.every((re) => re.test(text))) {
      const key = `${rule.category}|${rule.type}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ category: rule.category, type: rule.type });
      }
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
