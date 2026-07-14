// ---------------------------------------------------------------------------
// Mailing-compliance report (файл-2): per accountant, who completed or missed
// each required accounting-communication stage, counting UNIQUE applicable
// chats (never messages). Four categories, each a separate workflow so one chat
// can appear in several categories but exactly ONCE per category:
//
//   До 28 — Первичная документация  (primary_docs)
//   Долги до 5                       (debts)
//   До 10 — Заработная плата         (salary)
//   До 15 — Основные налоги          (main_taxes)
//
// Rules: exactly one current status per (chat, category, cycle); Margarita's
// manual confirmation wins over automatic detection; inactive chats excluded;
// sum of statuses never exceeds applicable chats. No violations are created here.
// Pure + deterministic so every number is testable and drill-downable.
// ---------------------------------------------------------------------------

export type MailingCategory = "primary_docs" | "debts" | "salary" | "main_taxes";

/** Ordered categories with their Russian section headers (file-2 layout). */
export const COMPLIANCE_CATEGORIES: { id: MailingCategory; label: string }[] = [
  { id: "primary_docs", label: "До 28 — Первичная документация" },
  { id: "debts", label: "Долги до 5" },
  { id: "salary", label: "До 10 — Заработная плата" },
  { id: "main_taxes", label: "До 15 — Основные налоги" },
];

export interface ComplianceChatInput {
  agr_no: string;
  accountant: string | null;
  /** "Active" | "Inactive" — inactive chats are excluded. */
  status: string;
  client?: string | null;
  contract?: string | null;
  chat_link?: string | null;
  language?: string | null;
}

export interface ComplianceMailingInput {
  agr_no: string;
  category: string;
  status: string | null;
  source: "manual" | "telegram" | string;
  confirmed?: boolean;
  confirmed_by?: string | null;
  confirmed_at?: string | null;
  detected_at?: string | null;
}

/** One chat behind a status count (drill-down: «покажи 7 чатов за Не запросил 1»). */
export interface ComplianceChatRef {
  agr_no: string;
  client: string | null;
  contract: string | null;
  chat_link: string | null;
  accountant: string | null;
  status: string;
  source: "manual" | "telegram" | string;
  confirmed: boolean;
  /** Relevant message/confirmation date. */
  at: string | null;
}

export interface ComplianceStatusCount {
  status: string;
  count: number;
  chats: ComplianceChatRef[];
}

export interface ComplianceCategoryResult {
  category: MailingCategory;
  label: string;
  statuses: ComplianceStatusCount[];
  /** Applicable chats for this accountant+category (with a resolved status). */
  applicable: number;
}

export interface ComplianceAccountantResult {
  accountant: string;
  categories: ComplianceCategoryResult[];
  /** Total chats this accountant is responsible for (active). */
  totalChats: number;
}

export interface MailingComplianceReport {
  period: string;
  perAccountant: ComplianceAccountantResult[];
}

export interface BuildComplianceOptions {
  /** Restrict to these accountants (roster order preserved). */
  roster?: string[];
  /** Include only active chats (default true). */
  activeOnly?: boolean;
}

/**
 * Build the compliance report. Manual mailing rows win over telegram for the
 * same (chat, category); each chat contributes exactly one status per category.
 */
export function buildMailingCompliance(
  chats: ComplianceChatInput[],
  mailings: ComplianceMailingInput[],
  period: string,
  options: BuildComplianceOptions = {}
): MailingComplianceReport {
  const activeOnly = options.activeOnly !== false;
  const chatById = new Map<string, ComplianceChatInput>();
  for (const c of chats) {
    if (activeOnly && c.status !== "Active") continue;
    chatById.set(c.agr_no, c);
  }

  // Resolve ONE mailing per (chat, category): manual (confirmed) beats telegram.
  const resolved = new Map<string, ComplianceMailingInput>(); // key agr_no|category
  for (const m of mailings) {
    if (!m.status) continue;
    if (!chatById.has(m.agr_no)) continue; // inactive / unknown chat → excluded
    const key = `${m.agr_no}|${m.category}`;
    const cur = resolved.get(key);
    if (!cur) {
      resolved.set(key, m);
      continue;
    }
    // manual wins; else the more recent detection.
    const better =
      (m.source === "manual" && cur.source !== "manual") ||
      (m.source === cur.source &&
        (m.confirmed_at ?? m.detected_at ?? "") > (cur.confirmed_at ?? cur.detected_at ?? ""));
    if (better) resolved.set(key, m);
  }

  // accountant → category → status → chat refs
  const byAcc = new Map<string, Map<MailingCategory, Map<string, ComplianceChatRef[]>>>();
  const ensureAcc = (name: string) => {
    if (!byAcc.has(name)) byAcc.set(name, new Map());
    return byAcc.get(name)!;
  };

  for (const [key, m] of resolved) {
    const agr_no = key.split("|")[0];
    const category = m.category as MailingCategory;
    if (!COMPLIANCE_CATEGORIES.some((c) => c.id === category)) continue;
    const chat = chatById.get(agr_no)!;
    const acc = chat.accountant?.trim() || "— Не назначено —";
    if (options.roster && options.roster.length > 0 && !options.roster.includes(acc)) {
      // still keep unassigned/off-roster? file-2 wants approved active roster only.
      continue;
    }
    const catMap = ensureAcc(acc);
    if (!catMap.has(category)) catMap.set(category, new Map());
    const statusMap = catMap.get(category)!;
    const status = m.status as string;
    if (!statusMap.has(status)) statusMap.set(status, []);
    statusMap.get(status)!.push({
      agr_no,
      client: chat.client ?? null,
      contract: chat.contract ?? agr_no,
      chat_link: chat.chat_link ?? null,
      accountant: chat.accountant ?? null,
      status,
      source: m.source,
      confirmed: m.confirmed ?? m.source === "manual",
      at: m.confirmed_at ?? m.detected_at ?? null,
    });
  }

  // Chats-per-accountant (active) for the header.
  const chatsPerAcc = new Map<string, number>();
  for (const c of chatById.values()) {
    const acc = c.accountant?.trim() || "— Не назначено —";
    chatsPerAcc.set(acc, (chatsPerAcc.get(acc) ?? 0) + 1);
  }

  // Assemble, in roster order when provided, else alphabetical.
  const accNames = options.roster && options.roster.length > 0
    ? options.roster.filter((n) => byAcc.has(n))
    : [...byAcc.keys()].sort((a, b) => a.localeCompare(b));

  const perAccountant: ComplianceAccountantResult[] = accNames.map((accountant) => {
    const catMap = byAcc.get(accountant)!;
    const categories: ComplianceCategoryResult[] = COMPLIANCE_CATEGORIES.map(({ id, label }) => {
      const statusMap = catMap.get(id) ?? new Map<string, ComplianceChatRef[]>();
      const statuses: ComplianceStatusCount[] = [...statusMap.entries()]
        .map(([status, refs]) => ({ status, count: refs.length, chats: refs }))
        .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status));
      const applicable = statuses.reduce((s, x) => s + x.count, 0);
      return { category: id, label, statuses, applicable };
    });
    return {
      accountant,
      categories,
      totalChats: chatsPerAcc.get(accountant) ?? 0,
    };
  });

  return { period, perAccountant };
}
