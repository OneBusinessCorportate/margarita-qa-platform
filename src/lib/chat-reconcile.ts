// ---------------------------------------------------------------------------
// Chat reconciliation (файл-2, critical priority): match the authoritative
// client/chat list (Excel «Чаты» + master data) against what's registered in the
// platform (mqa_chats), so every active client chat exists and nothing is
// silently missing. Pure + deterministic — the matching rules are unit-tested,
// the actual import is a thin wrapper that applies these decisions.
//
// Matching is intentionally conservative: a row is joined to a DB chat only on a
// STRONG key (same Telegram chat id, or same contract №, or an exact normalized
// client-name match). Anything weaker is reported as a conflict for review
// rather than joined to the wrong client.
// ---------------------------------------------------------------------------

/** Extract the raw Telegram chat id from a link, PRESERVING the sign (negative
 *  group ids must survive verbatim). "Telegram"/empty placeholders → null. */
export function telegramChatIdOf(link: string | null | undefined): string | null {
  if (!link) return null;
  const s = String(link).trim();
  if (!s || s.toLowerCase() === "telegram") return null;
  // web.telegram.org/a/#-5212778373  |  t.me/... | plain -5212778373
  const m = s.match(/#(-?\d+)/) || s.match(/(-?\d{5,})/);
  return m ? m[1] : null;
}

/** Normalize a Telegram link to the canonical web form, without changing the id. */
export function normalizeTelegramLink(link: string | null | undefined): string | null {
  const id = telegramChatIdOf(link);
  return id ? `https://web.telegram.org/a/#${id}` : null;
}

const LEGAL_FORMS = [
  // RU / EN / HY company + sole-proprietor markers stripped for name matching.
  "ип", "ооо", "оао", "зао", "пао", "ао",
  "llc", "ltd", "inc", "co", "jsc", "cjsc", "ojsc", "sp",
  "ձ", "աձ", "սպը", "բբը", "փբը", "ոպ", " պ",
];

/** Normalize a client name for matching across AM/RU/EN, ИП/ԱՁ/ООО, quotes,
 *  punctuation, extra spaces and transliteration noise. */
export function normalizeClientName(name: string | null | undefined): string {
  if (!name) return "";
  let s = name.normalize("NFKC").toLowerCase();
  s = s.replace(/[«»"'`״׳()]/g, " ");
  // Drop contract codes / N-tags FIRST, while hyphens are intact:
  //   «N B-3932», «N-23», «N 33», «B-3932».
  s = s.replace(/\bn\s*[-#]?\s*b?\s*-?\s*\d+\b/gi, " ");
  s = s.replace(/\bb-?\d+\b/gi, " ");
  // Trailing language markers used in chat names («… B-3932 RU»).
  s = s.replace(/\b(ru|am|eng|en)\b/gi, " ");
  s = s.replace(/[.,;:_\-–—/\\]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  const words = s.split(" ").filter((w) => w.length >= 2 && !LEGAL_FORMS.includes(w));
  return words.sort().join(" "); // order-independent (name/patronymic swaps)
}

export interface ReconcileRow {
  agr_no: string | null;
  chat_link: string | null;
  chat_name: string | null;
  accountant: string | null;
  status: string | null;
  hvhh?: string | null;
  name_agr?: string | null;
  language?: string | null;
}

export type ReconcileClass =
  | "matched" // present & correctly mapped
  | "missing" // active source chat absent from the platform → import
  | "link_missing" // contract present but its Telegram link is absent → backfill
  | "conflict"; // ambiguous — log for manual review, do NOT auto-join

export interface ReconcileResult {
  source: ReconcileRow;
  klass: ReconcileClass;
  matchedAgrNo: string | null;
  reason: string;
}

export interface ReconcileSummary {
  sourceRows: number;
  activeSource: number;
  matched: number;
  missing: number;
  linkMissing: number;
  conflicts: number;
}

export interface ReconcileReport {
  results: ReconcileResult[];
  summary: ReconcileSummary;
}

const isActive = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().startsWith("active");

export interface ChatHealthIssue {
  agr_no: string | null;
  chat_link: string | null;
  reason: string;
}

export interface ChatHealth {
  total: number;
  active: number;
  inactive: number;
  /** Active chats whose contract № is a placeholder (TG-…) — no real contract. */
  withoutContract: number;
  /** Active chats with no responsible accountant. */
  withoutAccountant: number;
  /** Active chats with no Telegram link. */
  withoutLink: number;
  /** Telegram chat ids mapped to more than one contract (duplicate mapping). */
  duplicateChatIds: number;
  /** Sample of the problematic rows (capped), for the admin table. */
  issues: ChatHealthIssue[];
}

/**
 * Health / reconciliation stats over the platform's chat registry (файл-2 admin
 * diagnostic). Surfaces exactly the gaps the task lists: missing contracts,
 * missing accountants, chats without links and duplicate chat-id mappings — so
 * missing/broken chats are visible immediately instead of silently ignored.
 */
export function computeChatHealth(chats: ReconcileRow[], issueCap = 200): ChatHealth {
  const h: ChatHealth = {
    total: chats.length,
    active: 0,
    inactive: 0,
    withoutContract: 0,
    withoutAccountant: 0,
    withoutLink: 0,
    duplicateChatIds: 0,
    issues: [],
  };
  const byChatId = new Map<string, string[]>();
  const push = (agr_no: string | null, chat_link: string | null, reason: string) => {
    if (h.issues.length < issueCap) h.issues.push({ agr_no, chat_link, reason });
  };

  for (const c of chats) {
    const active = isActive(c.status);
    if (active) h.active += 1;
    else h.inactive += 1;
    const cid = telegramChatIdOf(c.chat_link);
    if (cid) {
      if (!byChatId.has(cid)) byChatId.set(cid, []);
      byChatId.get(cid)!.push(c.agr_no ?? "?");
    }
    if (!active) continue;
    if (!c.agr_no || c.agr_no.startsWith("TG-")) {
      h.withoutContract += 1;
      push(c.agr_no, c.chat_link, "нет настоящего № договора (TG-заглушка)");
    }
    if (!c.accountant || !c.accountant.trim()) {
      h.withoutAccountant += 1;
      push(c.agr_no, c.chat_link, "не назначен бухгалтер");
    }
    if (!cid) {
      h.withoutLink += 1;
      push(c.agr_no, c.chat_link, "нет ссылки на Telegram-чат");
    }
  }

  for (const [cid, agrs] of byChatId) {
    if (agrs.length > 1) {
      h.duplicateChatIds += 1;
      push(agrs[0], `#${cid}`, `один чат ${cid} на несколько № договора: ${agrs.join(", ")}`);
    }
  }
  return h;
}

/**
 * Reconcile authoritative source rows against DB chats. `db` are the platform's
 * chats. Matching order: Telegram chat id → contract № → exact normalized name.
 */
export function reconcileChats(source: ReconcileRow[], db: ReconcileRow[]): ReconcileReport {
  const dbByChatId = new Map<string, ReconcileRow>();
  const dbByAgr = new Map<string, ReconcileRow>();
  const dbByName = new Map<string, ReconcileRow[]>();
  for (const c of db) {
    const cid = telegramChatIdOf(c.chat_link);
    if (cid) dbByChatId.set(cid, c);
    if (c.agr_no) dbByAgr.set(c.agr_no.trim(), c);
    const n = normalizeClientName(c.chat_name || c.name_agr);
    if (n) {
      if (!dbByName.has(n)) dbByName.set(n, []);
      dbByName.get(n)!.push(c);
    }
  }

  const results: ReconcileResult[] = [];
  const summary: ReconcileSummary = {
    sourceRows: source.length,
    activeSource: 0,
    matched: 0,
    missing: 0,
    linkMissing: 0,
    conflicts: 0,
  };

  for (const s of source) {
    const active = isActive(s.status);
    if (active) summary.activeSource += 1;

    const cid = telegramChatIdOf(s.chat_link);
    const byId = cid ? dbByChatId.get(cid) : undefined;
    const byAgr = s.agr_no ? dbByAgr.get(s.agr_no.trim()) : undefined;

    let res: ReconcileResult;
    if (byId) {
      // Same Telegram chat present. Conflict if it's mapped to a DIFFERENT contract.
      if (byAgr && byId.agr_no !== byAgr.agr_no) {
        res = { source: s, klass: "conflict", matchedAgrNo: byId.agr_no,
          reason: `chat ${cid} привязан к ${byId.agr_no}, но № договора источника — ${s.agr_no}` };
      } else if (!byId.agr_no || byId.agr_no.startsWith("TG-")) {
        res = { source: s, klass: "conflict", matchedAgrNo: byId.agr_no,
          reason: `chat ${cid} в базе без настоящего № договора (${byId.agr_no}) — привязать к ${s.agr_no}` };
      } else {
        res = { source: s, klass: "matched", matchedAgrNo: byId.agr_no, reason: "совпадение по Telegram chat id" };
      }
    } else if (byAgr) {
      // Contract exists; does it carry the Telegram link?
      if (cid && !telegramChatIdOf(byAgr.chat_link)) {
        res = { source: s, klass: "link_missing", matchedAgrNo: byAgr.agr_no,
          reason: `№ ${s.agr_no} есть, но без ссылки на чат — добавить ${cid}` };
      } else {
        res = { source: s, klass: "matched", matchedAgrNo: byAgr.agr_no, reason: "совпадение по № договора" };
      }
    } else {
      // No id/contract match — try an exact normalized-name match.
      const n = normalizeClientName(s.chat_name || s.name_agr);
      const nameHits = n ? dbByName.get(n) ?? [] : [];
      if (nameHits.length === 1) {
        res = { source: s, klass: "conflict", matchedAgrNo: nameHits[0].agr_no,
          reason: `имя совпало с ${nameHits[0].agr_no}, но № договора/чат отличаются — проверить` };
      } else if (nameHits.length > 1) {
        res = { source: s, klass: "conflict", matchedAgrNo: null,
          reason: `имя неоднозначно совпало с несколькими чатами — проверить` };
      } else if (active) {
        res = { source: s, klass: "missing", matchedAgrNo: null, reason: "активный чат отсутствует в платформе" };
      } else {
        res = { source: s, klass: "conflict", matchedAgrNo: null, reason: "неактивный и отсутствует — не импортируем" };
      }
    }

    results.push(res);
    if (res.klass === "matched") summary.matched += 1;
    else if (res.klass === "missing") summary.missing += 1;
    else if (res.klass === "link_missing") summary.linkMissing += 1;
    else summary.conflicts += 1;
  }

  return { results, summary };
}
