// ---------------------------------------------------------------------------
// Keyword-based mailing detector for Russian + Armenian accountant messages.
//
// Each rule tags a message with a signal TYPE — the API route counts signals
// per (chat, category, type) across all messages in a period to derive the
// correct graduated status ("Запросил 2" after two requests, "2-й написал"
// after two debt follow-ups, etc.).
//
// NEGATION: phrases like «не получил», «не отправлено», «не сделано» (RU) or
// «չստացա», «չի կատարվում» (HY) describe an action that DID NOT happen. They
// must never be counted as `done`/`paid` (that was the old bug — «зарплата не
// получил» matched the `получ` stem and was marked «Получил»). Instead a
// negated completion suppresses the positive signal and emits a `neg` signal,
// which `deriveStatus` surfaces as a "not completed" status.
// ---------------------------------------------------------------------------

/**
 * Signal type tags — describe what the accountant did in the message:
 *   done  — completed the action (sent taxes, received docs, received salary)
 *   req   — made a request / wrote the client (asked for docs, wrote about debt)
 *   call  — made a phone call (called about debt)
 *   paid  — client paid the debt (no debt remaining)
 *   neg   — explicitly NOT done ("не получил", "не отправлено", "չի կատարվում")
 */
export type SignalType = "done" | "req" | "call" | "paid" | "neg";

export interface MailingSignal {
  category: "main_taxes" | "salary" | "primary_docs" | "debts";
  type: SignalType;
}

interface Rule {
  category: MailingSignal["category"];
  type: SignalType;
  /** All of these must match for the rule to fire. */
  all: RegExp[];
  /** If ANY of these match, the rule is suppressed (used for negation). */
  none?: RegExp[];
}

// --- Category keyword fragments (reused by positive + negation rules) --------
// \b is ASCII-only, so Cyrillic "зп" needs explicit non-letter lookarounds.
const KW = {
  taxes_ru: /(налог|декларац|ндс|налогов)/i,
  salary_ru: /(зарплат|зарплн|ведомост|(?<![а-яёА-ЯЁ])зп(?![а-яёА-ЯЁ])|авансовый\s+отчет|авансов)/i,
  primary_ru: /(первичн|первичк|(?<![а-яёА-ЯЁ])акт(?:ами|ах|ов|ом|ам|[ыауе])?(?![а-яёА-ЯЁ])|документ|накладн|счет-факт|счёт-факт)/i,
  debts_ru: /(долг|задолженност|задолж)/i,
  // iu = Unicode case-fold so sentence-start capitals (Աշխատավարձ, Հարկ) match.
  taxes_hy: /(հարկ|ԱԱՀ|հայտ|հռչ|հաշվետ)/iu,
  salary_hy: /(աշխատավարձ|աշխ\.?\s*վ|ա\/վ|ա\.վ\.|հաշվ\.?\s*ց|ռոճիկ)/iu,
  primary_hy: /(փաստաթ|[աՈ][կք]տ|հաշիվ|[աՈ][կք]ներ|ն[եա]ր[կք]ա)/iu,
  debts_hy: /(պարտք|պարտաբ)/iu,
} as const;

// --- Negation detectors ------------------------------------------------------
// "не <опц. 1-2 слова> <глагол-выполнения>" — a completion that did NOT happen.
const NEG_DONE_RU =
  /(?<![а-яёА-ЯЁ])не\s+(?:[а-яёА-ЯЁ]+\s+){0,2}?(получ|пришл|прислал|подпис|сдал|сдела|сдан|подан|предостав|скинул|сброс|отправ|выслал|переслал|направ|подал|загруз|выгруз|отчита|задеклар|готов|выполн|оформ|провед|провёл|провел)/i;
// "не оплачен / не выплатил / не погашен / не закрыт" — debt still open.
const NEG_PAID_RU =
  /(?<![а-яёА-ЯЁ])не\s+(?:[а-яёА-ЯЁ]+\s+){0,2}?(оплат|оплач|выплат|погас|закрыт)/i;
// Armenian negation prefix չ- covering the done/paid verb families.
const NEG_HY =
  /չ(?:ի|ե[մսնք]|եք|կա|ստաց|ուղարկ|ներկայաց|հանձն|տրամ|վճար|մար|փակ|կատար|արվ)/u;

// --- Completion (done) verb fragments ---------------------------------------
// Explicit forms for "отправил/..." so the done side never matches the
// imperative REQUEST "отправьте". "сделал/готово/оформил/провёл" added so
// plain «Зарплата — сделано» is recognized.
const DONE_TAX_RU =
  /(отправ|подал|подан|сдан|направил|загрузил|выгрузил|сдала|отправила|отчита|задеклар|сдела|оформ|готов)/i;
const DONE_RECV_RU =
  /(получ|пришл|прислал|подпис|сдал|предоставил|скинул|сбросил|прислала|получила|пришла|передал|отправил|отправила|отправлен|отправлена|отправили|выслал|переслал|сдела|сделан|готов|выполн|оформ|провед|провёл|провел)/i;
const REQ_RU =
  /(запрос|прошу|просьб|нужн|пришлит|отправьт|скиньт|передайт|пожалуйст|жду|ожида)/i;

const RULES: Rule[] = [
  // --- main_taxes (Russian) -------------------------------------------------
  { category: "main_taxes", type: "done", all: [KW.taxes_ru, DONE_TAX_RU], none: [NEG_DONE_RU] },
  { category: "main_taxes", type: "neg", all: [KW.taxes_ru, NEG_DONE_RU] },
  // --- main_taxes (Armenian) ------------------------------------------------
  // հարկ=tax, ԱԱՀ=VAT, հայտ=declaration, ուղարկ=sent, ներկայաց=submitted
  {
    category: "main_taxes",
    type: "done",
    all: [KW.taxes_hy, /(ուղարկ|ներկայաց|հանձնե|բեռնե|ներբեռն)/iu],
    none: [NEG_HY],
  },
  { category: "main_taxes", type: "neg", all: [KW.taxes_hy, NEG_HY] },

  // --- salary (Russian) -----------------------------------------------------
  { category: "salary", type: "done", all: [KW.salary_ru, DONE_RECV_RU], none: [NEG_DONE_RU] },
  { category: "salary", type: "req", all: [KW.salary_ru, REQ_RU] },
  { category: "salary", type: "neg", all: [KW.salary_ru, NEG_DONE_RU] },
  // --- salary (Armenian) ----------------------------------------------------
  // աշխատավարձ=salary, հաշվետ=payroll, ստացական=receipt, ցուցակ=list
  {
    category: "salary",
    type: "done",
    all: [KW.salary_hy, /(ստաց|ուղարկ|տրամ|ստ\.)/iu],
    none: [NEG_HY],
  },
  {
    category: "salary",
    type: "req",
    all: [/(աշխատավարձ|աշխ\.?\s*վ|ա\/վ|ռոճիկ)/, /(խնդրե|կարիք|պե՞տք)/],
  },
  { category: "salary", type: "neg", all: [KW.salary_hy, NEG_HY] },

  // --- primary_docs (Russian) -----------------------------------------------
  { category: "primary_docs", type: "done", all: [KW.primary_ru, DONE_RECV_RU], none: [NEG_DONE_RU] },
  {
    category: "primary_docs",
    type: "req",
    all: [
      /(первичн|первичк|(?<![а-яёА-ЯЁ])акт(?:ами|ах|ов|ом|ам|[ыауе])?(?![а-яёА-ЯЁ])|документ|накладн)/i,
      REQ_RU,
    ],
  },
  { category: "primary_docs", type: "neg", all: [KW.primary_ru, NEG_DONE_RU] },
  // --- primary_docs (Armenian) ----------------------------------------------
  // փաստաթ=document, [աՈ][կք]տ=act, հաշիվ=invoice; iu = Unicode case-fold
  {
    category: "primary_docs",
    type: "done",
    all: [KW.primary_hy, /(ստաց|ուղարկ|հանձնե|ստ\.)/iu],
    none: [NEG_HY],
  },
  {
    category: "primary_docs",
    type: "req",
    all: [/(փաստաթ|[աՈ][կք]տ|հաշիվ)/iu, /(խնդրե|կարիք|պետք)/iu],
  },
  { category: "primary_docs", type: "neg", all: [KW.primary_hy, NEG_HY] },

  // --- debts (Russian) ------------------------------------------------------
  {
    category: "debts",
    type: "paid",
    all: [
      KW.debts_ru,
      /(оплатил|оплатила|оплачен|оплачена|оплачено|оплата\s+прошла|выплатил|выплатила|погашен|погасил|закрыт|закрыта|нет\s+долга|нет\s+задолж)/i,
    ],
    none: [NEG_PAID_RU],
  },
  {
    category: "debts",
    type: "call",
    all: [/(долг|задолженност)/i, /(позвон|звонил|звонок|обзвон|перезвон|созвон)/i],
  },
  {
    category: "debts",
    type: "req",
    all: [/(долг|задолженност)/i, /(написал|написала|напоминани|уведомил|сообщил|написали|напомнил)/i],
  },
  // --- debts (Armenian) — iu = Unicode case-fold handles sentence-start capitals
  // պարտք=debt, վճար=pay, զանգ=call, գր=wrote, հուշ=reminder
  {
    category: "debts",
    type: "paid",
    all: [KW.debts_hy, /(վճար|մարե|փակե|չկա\s+պ|պարտք\s+չ)/iu],
    none: [NEG_HY],
  },
  { category: "debts", type: "call", all: [KW.debts_hy, /(զանգ|զ\.)/iu] },
  { category: "debts", type: "req", all: [KW.debts_hy, /(գր[եէ]|հուշ|տեղեկ|ծանուց)/iu] },
];

/** All signals fired by a single message (may be several categories). */
export function detectAllSignals(text: string): MailingSignal[] {
  if (!text || text.length < 4) return [];
  const out: MailingSignal[] = [];
  const seen = new Set<string>(); // deduplicate (category, type) pairs
  for (const rule of RULES) {
    if (!rule.all.every((re) => re.test(text))) continue;
    if (rule.none && rule.none.some((re) => re.test(text))) continue;
    const key = `${rule.category}|${rule.type}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ category: rule.category, type: rule.type });
    }
  }
  return out;
}

export interface SignalCounts {
  done: number;
  req: number;
  call: number;
  paid: number;
  neg: number;
}

/**
 * Derive the final mailing status for a category from accumulated signal
 * counts across all messages in a period. Call this after counting signals
 * from every message.
 *
 * `done` always wins (a real completion later in the cycle overrides an earlier
 * "not yet"). An explicit `neg` with no completion surfaces as a "not done"
 * status so the panel flags it instead of leaving it neutral («Предстоящая»).
 */
export function deriveStatus(
  category: string,
  counts: { done: number; req: number; call: number; paid: number; neg?: number }
): string | null {
  const neg = counts.neg ?? 0;
  switch (category) {
    case "main_taxes":
      if (counts.done >= 1) return "Отправил";
      if (neg >= 1) return "Не отправил";
      return null;

    case "salary":
      if (counts.done >= 1) return "Получил";
      if (counts.req >= 2) return "Запросил 2, не получил";
      if (counts.req === 1) return "Запросил 1, не получил";
      if (neg >= 1) return "Запросил 1, не получил";
      return null;

    case "primary_docs":
      if (counts.done >= 1) return "Получил";
      if (counts.req >= 2) return "Запросил 2, не получил";
      if (counts.req === 1) return "Запросил 1, не получил";
      if (neg >= 1) return "Запросил 1, не получил";
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
