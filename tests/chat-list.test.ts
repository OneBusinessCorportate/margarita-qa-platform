import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SORT_OPTIONS,
  activityKey,
  cmpAgrNo,
  compareByActivity,
  isUnanswered,
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

test("isUnanswered is true only when the client had the last word", () => {
  assert.equal(isUnanswered(chat({ agr_no: "1", unanswered: true })), true);
  assert.equal(isUnanswered(chat({ agr_no: "1", unanswered: false })), false);
  // Unknown (feed-only chat, no captured messages) is not treated as unanswered.
  assert.equal(isUnanswered(chat({ agr_no: "1", unanswered: null })), false);
});
