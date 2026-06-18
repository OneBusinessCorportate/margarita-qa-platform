// ---------------------------------------------------------------------------
// Pure helpers for ordering / classifying the scoring page's chat list.
//
// Kept out of the React component so the ordering rules Margarita relies on
// (chronological order, contract-№ order, "still unanswered") are unit-tested
// data, not buried in JSX. The component supplies the stateful bits (the frozen
// "worst-first" snapshot, the per-day task fallback); everything here is pure.
// ---------------------------------------------------------------------------
import type { Chat } from "./types";
import { MONTHLY_CATEGORIES, type MonthlyCategory } from "./scoring";

/** How the chat list is ordered. */
export type SortBy = "activity" | "worst" | "number";

export const SORT_OPTIONS: { id: SortBy; label: string }[] = [
  { id: "activity", label: "по активности (свежие сверху)" },
  { id: "worst", label: "проблемные сверху" },
  { id: "number", label: "по № договора" },
];

/** Compare contract numbers numerically where possible ("59" < "118" < "B-3302"). */
export function cmpAgrNo(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Sort key for "по активности": the precise last-activity timestamp when the
 * sync has it (so 11:00 sorts above 10:30 on the same day), else the activity
 * date, else `fallback` (e.g. a task touch), else "" — which sinks the chat to
 * the bottom. ISO timestamps and ISO dates both sort lexicographically.
 */
export function activityKey(chat: Chat, fallback?: string | null): string {
  return chat.last_activity_at ?? chat.last_activity_date ?? fallback ?? "";
}

/**
 * Most-recent-activity-first comparator; ties (e.g. two chats with only a date,
 * or no activity at all) are broken by contract №. `keyFor` lets the caller fold
 * in extra signals (the per-day task fallback) while staying pure here.
 */
export function compareByActivity(
  a: Chat,
  b: Chat,
  keyFor: (c: Chat) => string = (c) => activityKey(c)
): number {
  const ka = keyFor(a);
  const kb = keyFor(b);
  if (ka !== kb) return kb.localeCompare(ka);
  return cmpAgrNo(a.agr_no, b.agr_no);
}

/** Is the chat still awaiting a reply — i.e. the client had the last word? */
export function isUnanswered(chat: Chat): boolean {
  return chat.unanswered === true;
}

/**
 * Is `link` a usable Telegram chat link we can actually open? Many mqa_chats
 * carry a non-Telegram value in chat_link — a WhatsApp URL, placeholder text
 * ("не работаем"), or a chat name someone pasted by mistake. Rendering an
 * "Открыть" button for those just sends QA to a dead page, so we gate on a real
 * web.telegram.org / t.me link.
 */
export function isTelegramLink(link?: string | null): boolean {
  if (!link) return false;
  return /(^|\/\/)(web\.telegram\.org|t\.me)\//.test(link.trim());
}

/**
 * How long a chat has been waiting for a reply, as a short Russian label
 * ("ждёт 3 ч", "ждёт 2 дн"), measured from the last message time to `now`.
 * Returns null when there's no timestamp or the time is in the future. Lets QA
 * triage the backlog oldest-first without doing the arithmetic in their head.
 */
export function waitingLabel(
  sinceISO: string | null | undefined,
  nowISO: string
): string | null {
  if (!sinceISO) return null;
  const ms = Date.parse(nowISO) - Date.parse(sinceISO);
  if (Number.isNaN(ms) || ms < 0) return null;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "ждёт <1 ч";
  if (hours < 24) return `ждёт ${hours} ч`;
  return `ждёт ${Math.floor(hours / 24)} дн`;
}

/**
 * Classify a chat's "Долги" follow-up status for display:
 *   none     — "Нет долга" (nothing owed)
 *   fail     — a failing status ("Не написал 1/2" — client wasn't chased)
 *   progress — any other in-flight status ("1-й написал", "1-й позвонил", …)
 * Returns null when there's no status to show. This is the real debt signal QA
 * tracks; the standing amount isn't in the data feed.
 */
export type DebtTone = "none" | "progress" | "fail";

export function debtTone(status: string | null | undefined): DebtTone | null {
  const s = (status ?? "").trim();
  if (!s) return null;
  if (/нет долга/i.test(s)) return "none";
  const debtCat = MONTHLY_CATEGORIES.find((c) => c.id === "debts");
  if (debtCat?.failStatuses.includes(s)) return "fail";
  return "progress";
}

/**
 * Format the chat's standing debt (mqa_chats.debts, sourced from the "Import
 * Debts" sheet) for display: the actual amount owed, so QA can see at a glance
 * whether the client has paid. Returns null when there's nothing to show.
 */
export function debtAmountLabel(
  debts: string | null | undefined
): { text: string; owed: boolean } | null {
  const s = (debts ?? "").trim();
  if (!s || s === "--" || s === "—") return null;
  if (/нет долга/i.test(s) || s === "0") return { text: "нет долга", owed: false };
  const n = Number(s.replace(/[\s,]/g, ""));
  if (Number.isFinite(n) && n > 0)
    return { text: `долг ${n.toLocaleString("ru-RU")} ֏`, owed: true };
  return { text: `долг: ${s}`, owed: true }; // legacy free-text
}

/**
 * Auto-fill for the monthly "Долги" status from the real debt data
 * (mqa_chats.debts, sourced from the "Import Debts" sheet, which lists only
 * clients who actually owe something):
 *   - an outstanding positive amount → null: there IS a debt, so the follow-up
 *     status ("1-й написал" / "Не написал 1" …) is Margarita's judgement to make.
 *   - anything else (not listed, blank, "Нет долга", "0") → "Нет долга": nothing
 *     is owed, so the status is unambiguous and shouldn't need manual entry.
 */
export function autoDebtStatus(debts: string | null | undefined): string | null {
  const s = (debts ?? "").trim();
  const n = Number(s.replace(/[\s,]/g, ""));
  if (Number.isFinite(n) && n > 0) return null;
  return "Нет долга";
}

/**
 * Auto-fill a monthly mailing status from facts we already have, so Margarita
 * doesn't set the obvious ones by hand every time (her main complaint). Returns
 * null when it genuinely can't be determined (then she/AI decides). Logic, not
 * guesswork:
 *   - Inactive client                       → "Inactive" (mailing N/A)
 *   - Долги with nothing owed (debt feed)    → "Нет долга"
 *   - deadline still ahead this month        → "Предстоящая" (nothing to do yet)
 */
export function autoMonthlyStatus(
  cat: MonthlyCategory,
  chatStatus: string | null | undefined,
  debts: string | null | undefined,
  checkingDateISO: string
): string | null {
  if (chatStatus === "Inactive" && cat.statuses.includes("Inactive")) return "Inactive";
  if (cat.id === "debts") {
    const d = autoDebtStatus(debts);
    if (d && cat.statuses.includes(d)) return d; // "Нет долга"
  }
  const day = Number(checkingDateISO.slice(8, 10));
  if (
    Number.isFinite(day) &&
    day > 0 &&
    day < cat.dueDay &&
    cat.statuses.includes("Предстоящая")
  )
    return "Предстоящая";
  return null;
}
