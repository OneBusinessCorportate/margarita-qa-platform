// ---------------------------------------------------------------------------
// Pure helpers for the debts ("долги") sync from the OneBusiness debts system.
//
// OneBusiness (ob_app.debts_current) computes debts per agreement automatically;
// the QA app's mqa_chats.agr_no is the same agreement-number scheme but the two
// stores disagree on Cyrillic vs Latin lookalikes (e.g. "В-4525" with a Cyrillic
// В vs "B-4525" with a Latin B). We fold homoglyphs to a canonical key so the
// join is reliable, then aggregate active debt into overdue / upcoming buckets.
// ---------------------------------------------------------------------------

/** One active debt row from ob_app.debts_current. */
export interface DebtRow {
  agr_id: string;
  due_dt: string | null; // ISO date
  debt: number | string | null; // numeric may arrive as string from PostgREST
  status: string | null; // 'active' | 'paid'
}

export interface DebtTotals {
  overdue: number; // active debt due on/before `asOf`
  upcoming: number; // active debt due after `asOf`
  total: number;
}

// Cyrillic → Latin lookalikes that show up in agreement numbers.
const HOMOGLYPHS: Record<string, string> = {
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O",
  Р: "P", С: "C", Т: "T", Х: "X", У: "Y",
};

/** Canonical join key: uppercase, strip spaces, fold Cyrillic homoglyphs. */
export function normalizeAgrNo(s: string | null | undefined): string {
  if (!s) return "";
  let out = "";
  for (const ch of s.trim().toUpperCase()) {
    if (/\s/.test(ch)) continue;
    out += HOMOGLYPHS[ch] ?? ch;
  }
  return out;
}

function toNum(v: number | string | null | undefined): number {
  const n = typeof v === "string" ? Number(v) : v ?? 0;
  return Number.isFinite(n) ? (n as number) : 0;
}

/**
 * Aggregate active debt rows by normalized agreement key into overdue / upcoming
 * totals. `asOf` is the boundary date (YYYY-MM-DD); due on/before it is overdue.
 */
export function aggregateDebts(
  rows: DebtRow[],
  asOf: string
): Map<string, DebtTotals> {
  const map = new Map<string, DebtTotals>();
  for (const r of rows) {
    if ((r.status ?? "") !== "active") continue;
    const debt = toNum(r.debt);
    if (debt <= 0) continue;
    const key = normalizeAgrNo(r.agr_id);
    if (!key) continue;
    const cur = map.get(key) ?? { overdue: 0, upcoming: 0, total: 0 };
    const due = r.due_dt ? String(r.due_dt).slice(0, 10) : null;
    if (due && due <= asOf) cur.overdue += debt;
    else cur.upcoming += debt;
    cur.total += debt;
    map.set(key, cur);
  }
  return map;
}

/**
 * The string written to mqa_chats.debts (consumed by the existing scoring UI):
 * the overdue amount when something is actually owed now, else "Нет долга".
 * Matches the format debtAmountLabel()/autoDebtStatus() already expect.
 */
export function debtsCellValue(totals: DebtTotals | undefined): string {
  if (totals && totals.overdue > 0) return String(Math.round(totals.overdue));
  return "Нет долга";
}

/**
 * The «Долги» follow-up status (a MONTHLY_CATEGORIES["debts"] option), derived
 * fully from the OneBusiness debts system: the overdue amount + the contact log
 * (ob_app.communications, this month). No overdue → «Нет долга»; with overdue,
 * the status reflects how the accountant followed up:
 *   call logged        → «1-й позвонил»
 *   ≥2 messages logged → «2-й написал»
 *   1 message logged   → «1-й написал»
 *   nothing logged     → «Не написал 1» (not contacted — a failing status)
 */
export function debtFollowupStatus(
  overdue: number,
  messages: number,
  calls: number
): string {
  if (!(overdue > 0)) return "Нет долга";
  if (calls > 0) return "1-й позвонил";
  if (messages >= 2) return "2-й написал";
  if (messages >= 1) return "1-й написал";
  return "Не написал 1";
}
