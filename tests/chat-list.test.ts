import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SORT_OPTIONS,
  activityKey,
  cmpAgrNo,
  compareByActivity,
  debtAmountLabel,
  debtTone,
  isTelegramLink,
  isUnanswered,
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

test("waitingLabel renders hours then days from the last message", () => {
  const now = "2026-06-17T12:00:00Z";
  assert.equal(waitingLabel("2026-06-17T11:40:00Z", now), "ждёт <1 ч");
  assert.equal(waitingLabel("2026-06-17T09:00:00Z", now), "ждёт 3 ч");
  assert.equal(waitingLabel("2026-06-15T12:00:00Z", now), "ждёт 2 дн");
  // No timestamp, or a future time, yields no label.
  assert.equal(waitingLabel(null, now), null);
  assert.equal(waitingLabel("2026-06-17T13:00:00Z", now), null);
});
