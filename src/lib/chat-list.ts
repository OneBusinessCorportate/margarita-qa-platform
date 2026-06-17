// ---------------------------------------------------------------------------
// Pure helpers for ordering / classifying the scoring page's chat list.
//
// Kept out of the React component so the ordering rules Margarita relies on
// (chronological order, contract-№ order, "still unanswered") are unit-tested
// data, not buried in JSX. The component supplies the stateful bits (the frozen
// "worst-first" snapshot, the per-day task fallback); everything here is pure.
// ---------------------------------------------------------------------------
import type { Chat } from "./types";

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
