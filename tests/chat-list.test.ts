import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SORT_OPTIONS,
  activityKey,
  autoDebtStatus,
  autoMonthlyStatus,
  cmpAgrNo,
  compareByActivity,
  debtAmountLabel,
  debtTone,
  hasNewMessageAfterEval,
  isNewChat,
  isTelegramLink,
  isUnanswered,
  latestActivityKey,
  matchesChatQuery,
  resolveChatTokens,
  splitQueryTokens,
  telegramChatId,
  waitingLabel,
} from "../src/lib/chat-list";
import type { Chat } from "../src/lib/types";

// Minimal chat factory — only the fields the list helpers read.
function chat(partial: Partial<Chat> & { agr_no: string }): Chat {
  return {
    agr_no: partial.agr_no,
    hvhh: null,
    name_agr: null,
    name_tax: null,
    status: "Active",
    tax_activation_date: null,
    chat_name: partial.chat_name ?? `Chat ${partial.agr_no}`,
    chat_link: null,
    accountant: null,
    manager: null,
    debts: null,
    created_date: null,
    last_activity_date: null,
    last_activity_at: null,
    last_sender_role: null,
    unanswered: null,
    ...partial,
  };
}

test("sort options expose the three orders", () => {
  assert.deepEqual(SORT_OPTIONS.map((o) => o.id), ["activity", "worst", "number"]);
});

test("cmpAgrNo orders contract numbers numerically, not lexically", () => {
  // The bug Margarita would hit lexically: "118" < "59". Numeric-aware fixes it.
  assert.ok(cmpAgrNo("59", "118") < 0);
  assert.ok(cmpAgrNo("118", "59") > 0);
  assert.equal(cmpAgrNo("59", "59"), 0);
  // Prefixed numbers compare numerically too: 590 < 3302.
  assert.ok(cmpAgrNo("B-590", "B-3302") < 0);
  assert.ok(cmpAgrNo("B-3302", "B-590") > 0);
});

test("cmpAgrNo gives a stable total order when used to sort", () => {
  const ids = ["118", "59", "1117", "9"];
  assert.deepEqual([...ids].sort(cmpAgrNo), ["9", "59", "118", "1117"]);
});

test("activityKey prefers the precise timestamp over the date", () => {
  assert.equal(
    activityKey(chat({ agr_no: "1", last_activity_at: "2026-06-17T11:00:00Z", last_activity_date: "2026-06-17" })),
    "2026-06-17T11:00:00Z"
  );
  assert.equal(
    activityKey(chat({ agr_no: "1", last_activity_date: "2026-06-17" })),
    "2026-06-17"
  );
  // Falls back to the caller-supplied value (e.g. a task touch), then "".
  assert.equal(activityKey(chat({ agr_no: "1" }), "2026-06-10"), "2026-06-10");
  assert.equal(activityKey(chat({ agr_no: "1" })), "");
});

test("compareByActivity sorts most-recent-first within the same day", () => {
  // The exact case Margarita reported: 11:00 must sort above 10:30.
  const earlier = chat({ agr_no: "10", last_activity_at: "2026-06-17T10:30:00Z" });
  const later = chat({ agr_no: "20", last_activity_at: "2026-06-17T11:00:00Z" });
  const sorted = [earlier, later].sort((a, b) => compareByActivity(a, b));
  assert.deepEqual(sorted.map((c) => c.agr_no), ["20", "10"]);
});

test("compareByActivity sinks chats with no activity to the bottom", () => {
  const active = chat({ agr_no: "10", last_activity_at: "2026-06-17T10:00:00Z" });
  const silent = chat({ agr_no: "20" });
  const sorted = [silent, active].sort((a, b) => compareByActivity(a, b));
  assert.deepEqual(sorted.map((c) => c.agr_no), ["10", "20"]);
});

test("compareByActivity breaks ties by contract № (numeric)", () => {
  const a = chat({ agr_no: "118", last_activity_date: "2026-06-17" });
  const b = chat({ agr_no: "59", last_activity_date: "2026-06-17" });
  const sorted = [a, b].sort((x, y) => compareByActivity(x, y));
  assert.deepEqual(sorted.map((c) => c.agr_no), ["59", "118"]);
});

test("compareByActivity honours a custom key (task-touch fallback)", () => {
  // Neither chat has its own activity; the caller's key resolves it.
  const a = chat({ agr_no: "1" });
  const b = chat({ agr_no: "2" });
  const taskDate: Record<string, string> = { "1": "2026-06-16", "2": "2026-06-17" };
  const key = (c: Chat) => activityKey(c, taskDate[c.agr_no]);
  const sorted = [a, b].sort((x, y) => compareByActivity(x, y, key));
  assert.deepEqual(sorted.map((c) => c.agr_no), ["2", "1"]);
});

test("latestActivityKey prefers a precise time over a coarse same-day date", () => {
  // The day-view bug: the per-day feed only knew the date, masking the chat's
  // precise timestamp, so same-day chats tied and fell back to contract-№.
  assert.equal(
    latestActivityKey("2026-06-15", "2026-06-15T11:00:00Z", "2026-06-15"),
    "2026-06-15T11:00:00Z"
  );
  // Two precise times on the same day: the later one wins (11:00 over 10:30).
  assert.equal(
    latestActivityKey("2026-06-15T10:30:00Z", "2026-06-15T11:00:00Z"),
    "2026-06-15T11:00:00Z"
  );
  // Skips empty/missing sources and sinks a chat with nothing to "".
  assert.equal(latestActivityKey(undefined, null, "2026-06-14"), "2026-06-14");
  assert.equal(latestActivityKey(undefined, null), "");
});

test("latestActivityKey fixes same-day ordering via compareByActivity", () => {
  // Both active on 06-15; only their precise times differ. With the latest key
  // they order by activity time, not by contract № (118 must sit below 59).
  const a = chat({ agr_no: "118", last_activity_date: "2026-06-15", last_activity_at: "2026-06-15T09:00:00Z" });
  const b = chat({ agr_no: "59", last_activity_date: "2026-06-15", last_activity_at: "2026-06-15T16:00:00Z" });
  const key = (c: Chat) => latestActivityKey(c.last_activity_date, c.last_activity_at);
  const sorted = [a, b].sort((x, y) => compareByActivity(x, y, key));
  assert.deepEqual(sorted.map((c) => c.agr_no), ["59", "118"]);
});

test("isTelegramLink accepts only real Telegram links", () => {
  assert.equal(isTelegramLink("https://web.telegram.org/a/#-4838549046"), true);
  assert.equal(isTelegramLink("https://web.telegram.org/k/#-4838549046"), true);
  assert.equal(isTelegramLink("https://t.me/+ajvcAOzUVsNkMzVi"), true);
  assert.equal(isTelegramLink("web.telegram.org/a/#-1"), true);
  // Junk values seen in real data must NOT render an "Открыть" button.
  assert.equal(isTelegramLink("https://web.whatsapp.com"), false);
  assert.equal(isTelegramLink("Հով Խաչ N-1579 AM (telegram.org)"), false);
  assert.equal(isTelegramLink("не работаем"), false);
  assert.equal(isTelegramLink(""), false);
  assert.equal(isTelegramLink(null), false);
  assert.equal(isTelegramLink(undefined), false);
});

test("telegramChatId extracts the chat id from any Telegram link form", () => {
  // The exact links Margarita pasted in the feedback (item 5).
  assert.equal(telegramChatId("https://web.telegram.org/a/#-5171468893"), "-5171468893");
  // Same conversation via the "K" client must yield the SAME id.
  assert.equal(telegramChatId("https://web.telegram.org/k/#-5171468893"), "-5171468893");
  // t.me invite / handle (lower-cased).
  assert.equal(telegramChatId("https://t.me/+ajvcAOzUVsNkMzVi"), "+ajvcaozuvsnkmzvi");
  assert.equal(telegramChatId("https://t.me/SomeHandle"), "somehandle");
  // No id / junk values.
  assert.equal(telegramChatId("не работаем"), null);
  assert.equal(telegramChatId(null), null);
  assert.equal(telegramChatId(undefined), null);
});

test("matchesChatQuery matches by №, name, agreement name and chat link", () => {
  const c = chat({
    agr_no: "N-6",
    chat_name: "ИП Александр Пачин N-6 RU",
    name_agr: "Пачин А.",
    chat_link: "https://web.telegram.org/a/#-5171468893",
  });
  assert.equal(matchesChatQuery(c, ""), true); // empty query matches all
  assert.equal(matchesChatQuery(c, "n-6"), true); // contract №, case-insensitive
  assert.equal(matchesChatQuery(c, "пачин"), true); // chat name
  assert.equal(matchesChatQuery(c, "Пачин А."), true); // agreement name
  assert.equal(matchesChatQuery(c, "777"), false); // no match
});

test("matchesChatQuery finds a chat by a pasted Telegram link across clients", () => {
  const c = chat({
    agr_no: "59",
    chat_name: "Chat 59",
    // stored as the "K" client...
    chat_link: "https://web.telegram.org/k/#-5171468893",
  });
  // ...but Margarita pastes the "A" client link → still matches by chat id.
  assert.equal(matchesChatQuery(c, "https://web.telegram.org/a/#-5171468893"), true);
  // A different chat id must NOT match.
  assert.equal(matchesChatQuery(c, "https://web.telegram.org/a/#-4962919740"), false);
});

test("splitQueryTokens splits on lines / commas but keeps names with spaces", () => {
  assert.deepEqual(
    splitQueryTokens("https://web.telegram.org/a/#-1\nhttps://web.telegram.org/a/#-2"),
    ["https://web.telegram.org/a/#-1", "https://web.telegram.org/a/#-2"]
  );
  assert.deepEqual(splitQueryTokens("59, 118 ; N-6"), ["59", "118", "N-6"]);
  // A single chat name with spaces is one token, not split.
  assert.deepEqual(splitQueryTokens("ИП Александр Пачин"), ["ИП Александр Пачин"]);
  assert.deepEqual(splitQueryTokens("   "), []);
});

test("resolveChatTokens resolves a multi-link paste to distinct chats", () => {
  const chats = [
    chat({ agr_no: "1", chat_link: "https://web.telegram.org/a/#-5171468893" }),
    chat({ agr_no: "2", chat_link: "https://web.telegram.org/k/#-4962919740" }),
    chat({ agr_no: "59", chat_name: "ИП Пачин" }),
  ];
  const { matched, unmatched } = resolveChatTokens(
    chats,
    // two of her pasted links (one via the other web client) + a № + a missing one
    "https://web.telegram.org/a/#-5171468893\nhttps://web.telegram.org/a/#-4962919740\n59\nhttps://web.telegram.org/a/#-9999999999"
  );
  assert.deepEqual(matched.map((m) => m.chat.agr_no), ["1", "2", "59"]);
  // The chat absent from the system is reported back (item 6 transparency).
  assert.deepEqual(unmatched, ["https://web.telegram.org/a/#-9999999999"]);
});

test("resolveChatTokens never returns the same chat twice", () => {
  const chats = [chat({ agr_no: "1", chat_name: "Дубль" })];
  const { matched, unmatched } = resolveChatTokens(chats, "1\nДубль");
  assert.equal(matched.length, 1);
  assert.equal(matched[0].chat.agr_no, "1");
  assert.deepEqual(unmatched, ["Дубль"]); // second token had no unused chat left
});

test("isUnanswered is true only when the client had the last word", () => {
  assert.equal(isUnanswered(chat({ agr_no: "1", unanswered: true })), true);
  assert.equal(isUnanswered(chat({ agr_no: "1", unanswered: false })), false);
  // Unknown (feed-only chat, no captured messages) is not treated as unanswered.
  assert.equal(isUnanswered(chat({ agr_no: "1", unanswered: null })), false);
});

test("debtTone classifies the Долги follow-up status", () => {
  assert.equal(debtTone("Нет долга"), "none");
  assert.equal(debtTone("Не написал 1"), "fail");
  assert.equal(debtTone("Не написал 2"), "fail");
  assert.equal(debtTone("1-й написал"), "progress");
  assert.equal(debtTone("1-й позвонил"), "progress");
  assert.equal(debtTone(""), null);
  assert.equal(debtTone(null), null);
  assert.equal(debtTone(undefined), null);
});

test("debtAmountLabel formats the standing debt amount", () => {
  const owed = debtAmountLabel("24000")!;
  assert.equal(owed.owed, true);
  // Grouped with the locale separator (NBSP) — assert digits + currency, not the exact space.
  assert.match(owed.text, /долг.*24.*000.*֏/);
  assert.deepEqual(debtAmountLabel("Нет долга"), { text: "нет долга", owed: false });
  assert.deepEqual(debtAmountLabel("0"), { text: "нет долга", owed: false });
  assert.equal(debtAmountLabel(null), null);
  assert.equal(debtAmountLabel("--"), null);
  assert.equal(debtAmountLabel(""), null);
});

test("autoDebtStatus fills «Нет долга» unless a real amount is owed", () => {
  // No recorded debt (not in the debt sheet, blank, or explicit) -> auto-fill.
  assert.equal(autoDebtStatus(null), "Нет долга");
  assert.equal(autoDebtStatus(""), "Нет долга");
  assert.equal(autoDebtStatus("Нет долга"), "Нет долга");
  assert.equal(autoDebtStatus("0"), "Нет долга");
  // An outstanding amount -> no auto-fill (Margarita assesses the follow-up).
  assert.equal(autoDebtStatus("24000"), null);
  assert.equal(autoDebtStatus("24 000"), null);
});

test("waitingLabel renders hours then days from the last message", () => {
  const now = "2026-06-17T12:00:00Z";
  assert.equal(waitingLabel("2026-06-17T11:40:00Z", now), "ждёт <1 ч");
  assert.equal(waitingLabel("2026-06-17T09:00:00Z", now), "ждёт 3 ч");
  assert.equal(waitingLabel("2026-06-15T12:00:00Z", now), "ждёт 2 дн");
  // No timestamp, or a future time, yields no label.
  assert.equal(waitingLabel(null, now), null);
  assert.equal(waitingLabel("2026-06-17T13:00:00Z", now), null);
});

// --- autoMonthlyStatus: auto-fill the obvious monthly statuses ---------------
import { MONTHLY_CATEGORIES } from "../src/lib/scoring";
const catBy = (id: string) => MONTHLY_CATEGORIES.find((c) => c.id === id)!;

test("autoMonthlyStatus: debts with nothing owed → Нет долга", () => {
  assert.equal(autoMonthlyStatus(catBy("debts"), "Active", "Нет долга", "2026-06-18"), "Нет долга");
  assert.equal(autoMonthlyStatus(catBy("debts"), "Active", "0", "2026-06-18"), "Нет долга");
});

test("autoMonthlyStatus: deadline still ahead this month → Предстоящая", () => {
  // taxes due day 15; on the 3rd it's upcoming.
  assert.equal(autoMonthlyStatus(catBy("main_taxes"), "Active", null, "2026-06-03"), "Предстоящая");
});

test("autoMonthlyStatus: deadline reached → the mailing's done status", () => {
  // Once the due day passes, the routine mailing defaults to «done» so Margarita
  // only flips the exceptions instead of marking each chat by hand.
  assert.equal(autoMonthlyStatus(catBy("main_taxes"), "Active", null, "2026-06-20"), "Отправил");
  // On the due day itself it already counts as expected-done.
  assert.equal(autoMonthlyStatus(catBy("salary"), "Active", null, "2026-06-10"), "Получил");
  assert.equal(autoMonthlyStatus(catBy("primary_docs"), "Active", null, "2026-06-28"), "Получил");
  // Before the due day it's still upcoming, not yet done.
  assert.equal(autoMonthlyStatus(catBy("salary"), "Active", null, "2026-06-05"), "Предстоящая");
});

test("autoMonthlyStatus: a debt that is owed isn't auto-resolved after due day", () => {
  // debts due day 5; on the 18th with an amount owed → null (she assesses).
  assert.equal(autoMonthlyStatus(catBy("debts"), "Active", "76000", "2026-06-18"), null);
});

test("autoMonthlyStatus: Inactive client → Inactive", () => {
  assert.equal(autoMonthlyStatus(catBy("salary"), "Inactive", null, "2026-06-18"), "Inactive");
});

import { canonicalMonthlyStatus } from "../src/lib/scoring";
test("canonicalMonthlyStatus maps mis-cased/legacy statuses to a real option", () => {
  const debts = catBy("debts");
  assert.equal(canonicalMonthlyStatus(debts, "нет долга"), "Нет долга"); // lowercase legacy
  assert.equal(canonicalMonthlyStatus(debts, "  Нет долга "), "Нет долга");
  assert.equal(canonicalMonthlyStatus(debts, "1-й написал"), "1-й написал");
  assert.equal(canonicalMonthlyStatus(debts, "garbage"), ""); // not an option
  assert.equal(canonicalMonthlyStatus(debts, null), "");
});

test("isNewChat: created within the window of asOf", () => {
  assert.equal(isNewChat("2026-06-18", "2026-06-19"), true); // 1 day old
  assert.equal(isNewChat("2026-06-19", "2026-06-19"), true); // created today
  assert.equal(isNewChat("2026-06-10", "2026-06-19"), false); // 9 days old
  assert.equal(isNewChat(null, "2026-06-19"), false); // unknown creation date
  // A future-dated creation isn't "new" (guards bad data).
  assert.equal(isNewChat("2026-06-25", "2026-06-19"), false);
});

test("hasNewMessageAfterEval: later message re-opens a scored chat", () => {
  // Message after the evaluation → needs re-check.
  assert.equal(
    hasNewMessageAfterEval("2026-06-19T15:00:00Z", "2026-06-19T12:00:00Z"),
    true
  );
  // Message before the evaluation → nothing new.
  assert.equal(
    hasNewMessageAfterEval("2026-06-19T10:00:00Z", "2026-06-19T12:00:00Z"),
    false
  );
  // Missing data → false (no false positives).
  assert.equal(hasNewMessageAfterEval(null, "2026-06-19T12:00:00Z"), false);
  assert.equal(hasNewMessageAfterEval("2026-06-19T15:00:00Z", null), false);
});
