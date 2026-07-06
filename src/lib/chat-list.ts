// ---------------------------------------------------------------------------
// Pure helpers for ordering / classifying the scoring page's chat list.
//
// Kept out of the React component so the ordering rules Margarita relies on
// (chronological order, contract-№ order, "still unanswered") are unit-tested
// data, not buried in JSX. The component supplies the stateful bits (the frozen
// "worst-first" snapshot, the per-day task fallback); everything here is pure.
// ---------------------------------------------------------------------------
import type { Chat } from "./types";
import { MONTHLY_CATEGORIES, daysBetween, type MonthlyCategory } from "./scoring";

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

/**
 * The activity sort key for the DAY view. Several sources may know when a chat
 * was last active — the per-day feed's precise `last_at`, the chat's own
 * `last_activity_at`, or just a date. Pick the LATEST non-empty one. Because a
 * full ISO timestamp sorts after its own date prefix ("…-15T11:00" > "…-15"),
 * choosing the latest also means a precise time wins over a coarse same-day
 * date — so same-day chats order by real activity time instead of collapsing to
 * a tie (which then fell back to contract-№, the "alphabetical" order Margarita
 * complained about). ISO strings sort lexicographically, so a plain string
 * comparison is correct.
 */
export function latestActivityKey(
  ...candidates: (string | null | undefined)[]
): string {
  let best = "";
  for (const c of candidates) {
    if (c && c > best) best = c;
  }
  return best;
}

/** Is the chat still awaiting a reply — i.e. the client had the last word? */
export function isUnanswered(chat: Chat): boolean {
  return chat.unanswered === true;
}

/**
 * Was the chat created within `days` of `asOf`? Used to surface brand-new chats
 * (item 6 — "как отображаются новые созданные чаты? я не вижу их в системе") with
 * a 🆕 badge and to keep them in the day view even before they have message
 * activity in the feed.
 */
export function isNewChat(
  createdDate: string | null | undefined,
  asOf: string,
  days = 3
): boolean {
  if (!createdDate) return false;
  const n = daysBetween(createdDate, asOf);
  return n >= 0 && n <= days;
}

/**
 * Did a new message land AFTER Margarita's evaluation for the day (item 9 /
 * item 7)? Once a chat is scored, any later client/staff message means it should
 * be re-checked — and per the boss's rule belongs to the next checking period.
 * Both are ISO timestamps; ISO sorts lexicographically.
 */
export function hasNewMessageAfterEval(
  lastActivityAt: string | null | undefined,
  evalCreatedAt: string | null | undefined
): boolean {
  if (!lastActivityAt || !evalCreatedAt) return false;
  return lastActivityAt > evalCreatedAt;
}

/**
 * Pull the Telegram chat id out of a link so two links to the SAME conversation
 * match even when they use different web clients ("/a/" vs "/k/") or the chat is
 * referenced as a t.me invite. Returns the numeric group id ("-5171468893") for
 * web.telegram.org links, or the t.me slug, else null. Used by the search /
 * "add to QA" box so Margarita can paste a Telegram link and land on the chat.
 */
export function telegramChatId(link?: string | null): string | null {
  if (!link) return null;
  const s = link.trim();
  const hash = s.match(/#(-?\d+)/); // web.telegram.org/a/#-5171468893
  if (hash) return hash[1];
  // Private group/channel link (t.me/c/<internal id>/<msg>): the id is the
  // digits after "/c/", not the literal "c" the generic rule below would grab —
  // otherwise every private chat would collapse to the same id.
  const privateGroup = s.match(/t\.me\/c\/(\d+)/i);
  if (privateGroup) return `c${privateGroup[1]}`;
  const tme = s.match(/t\.me\/([+A-Za-z0-9_-]+)/i); // t.me/+invite or t.me/handle
  if (tme) return tme[1].toLowerCase();
  return null;
}

/**
 * Does a chat match a free-text query? Matches contract №, chat name, agreement
 * name, the raw chat link, OR — when a Telegram link is pasted — the chat's
 * Telegram id (so a "/a/" link finds a chat stored with a "/k/" or t.me link).
 * Shared by the scoring "add to QA" search and the Задачи search so both behave
 * the same way. An empty query matches everything.
 */
export function matchesChatQuery(chat: Chat, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (
    chat.agr_no.toLowerCase().includes(q) ||
    chat.chat_name.toLowerCase().includes(q) ||
    (chat.name_agr ?? "").toLowerCase().includes(q) ||
    (chat.chat_link ?? "").toLowerCase().includes(q)
  )
    return true;
  // Telegram-link paste: compare by the chat id so A/K/t.me variants all match.
  const qid = telegramChatId(query);
  const cid = telegramChatId(chat.chat_link);
  return Boolean(qid && cid && qid === cid);
}

/**
 * Split a pasted blob into individual search tokens — one per line, comma or
 * semicolon. Lets Margarita paste several chats at once (her feedback listed 5
 * Telegram links) and add them all in one go. Single spaces are NOT split, so a
 * pasted chat name with spaces stays intact.
 */
export function splitQueryTokens(text: string): string[] {
  return text
    .split(/[\n,;|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A pasted token resolved to a chat (or not). */
export interface TokenResolution {
  matched: { token: string; chat: Chat }[];
  /** Tokens that matched no chat in the system — surfaced to the user (item 6:
   *  "не все чаты есть в платформе" — tells her exactly which ones are missing). */
  unmatched: string[];
}

/**
 * Resolve a multi-token paste to chats. Each token is matched with
 * matchesChatQuery (№ / name / Telegram link); the first not-yet-used chat
 * wins, so pasting N distinct links yields N distinct chats. Tokens that match
 * nothing come back in `unmatched`.
 */
export function resolveChatTokens(chats: Chat[], text: string): TokenResolution {
  const matched: { token: string; chat: Chat }[] = [];
  const unmatched: string[] = [];
  const used = new Set<string>();
  for (const token of splitQueryTokens(text)) {
    const hit = chats.find((c) => !used.has(c.agr_no) && matchesChatQuery(c, token));
    if (hit) {
      matched.push({ token, chat: hit });
      used.add(hit.agr_no);
    } else {
      unmatched.push(token);
    }
  }
  return { matched, unmatched };
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
 *   - otherwise                              → "Предстоящая": the cell stays in
 *     the waiting state until the message scan (keyword + AI) detects the
 *     action in the chat, or Margarita sets it by hand. Nothing is ever marked
 *     done without evidence — the old post-deadline optimistic «Получил» /
 *     «Отправил» fill hid real failures behind a default.
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
  if (!Number.isFinite(day) || day <= 0 || !cat.statuses.includes("Предстоящая")) {
    return null;
  }
  if (day < cat.dueDay) return "Предстоящая";
  // Deadline passed: the template mailings stay «Предстоящая» until evidence
  // arrives; «Долги» with money still owed goes blank — the follow-up status
  // is Margarita's judgement, not something to default.
  return cat.id === "debts" ? null : "Предстоящая";
}
