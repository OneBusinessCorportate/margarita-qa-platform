import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSystemPrompt,
  effectiveWaitingOn,
  formatTranscript,
  isResolvedWatched,
  parseVerdicts,
  sameInstant,
  selectFewShot,
  type UnansweredLabel,
} from "../src/lib/unanswered";

test("formatTranscript labels client vs staff and truncates", () => {
  const out = formatTranscript(
    [
      { role: "client", text: "Здравствуйте, когда отчёт?", at: "2026-06-18T10:00:00Z" },
      { role: "accountant", text: "Сегодня вечером", at: "2026-06-18T10:05:00Z" },
    ],
    100
  );
  assert.match(out, /КЛИЕНТ: Здравствуйте/);
  assert.match(out, /СОТРУДНИК \(accountant\): Сегодня вечером/);
});

test("formatTranscript handles empty / attachment messages", () => {
  assert.equal(formatTranscript([]), "(нет сообщений)");
  const out = formatTranscript([{ role: "client", text: null, at: "x" }]);
  assert.match(out, /вложение\/пусто/);
});

test("selectFewShot prioritizes corrections, then fills, respects max", () => {
  const labels: UnansweredLabel[] = [
    { last_msg_text: "a", ai_unanswered: true, human_unanswered: true }, // agree
    { last_msg_text: "b", ai_unanswered: true, human_unanswered: false }, // correction
    { last_msg_text: "c", ai_unanswered: false, human_unanswered: false }, // agree
    { last_msg_text: "", ai_unanswered: true, human_unanswered: false }, // dropped (empty)
  ];
  const chosen = selectFewShot(labels, 2);
  assert.equal(chosen.length, 2);
  assert.equal(chosen[0].last_msg_text, "b"); // correction first
});

test("buildSystemPrompt embeds confirmed labels as examples", () => {
  const sys = buildSystemPrompt([
    { last_msg_text: "спасибо большое", ai_unanswered: true, human_unanswered: false },
  ]);
  assert.match(sys, /спасибо большое/);
  assert.match(sys, /ответа не требуется/);
});

test("parseVerdicts derives unanswered from waiting_on, defaults safely", () => {
  const text = JSON.stringify({
    results: [
      { agr_no: "B-1", waiting_on: "staff", reason: "вопрос", confidence: "high" },
      { agr_no: "B-2", waiting_on: "client", reason: "ждём документы", confidence: "bogus" },
      { agr_no: "B-3", waiting_on: "none", reason: "спасибо", confidence: "low" },
      { agr_no: "B-4", waiting_on: "weird", reason: "x", confidence: "low" }, // bad enum → none
      { agr_no: 99, waiting_on: "staff" }, // invalid agr_no → dropped
    ],
  });
  const v = parseVerdicts(text);
  assert.equal(v.length, 4);
  assert.equal(v[0].unanswered, true); // staff → we owe a reply
  assert.equal(v[1].unanswered, false); // client → not our turn
  assert.equal(v[1].confidence, "low"); // invalid enum coerced
  assert.equal(v[2].unanswered, false); // none → finished
  assert.equal(v[3].waiting_on, "none"); // invalid waiting_on coerced
});

test("parseVerdicts returns [] on non-JSON", () => {
  assert.deepEqual(parseVerdicts("not json"), []);
  assert.deepEqual(parseVerdicts("{}"), []);
});

test("effectiveWaitingOn precedence: human → AI → rule", () => {
  // human ✔/✘ wins over everything
  assert.equal(effectiveWaitingOn({ human_unanswered: true, ai_waiting_on: "none" }, false), "staff");
  assert.equal(effectiveWaitingOn({ human_unanswered: false, ai_waiting_on: "staff" }, true), "none");
  // then AI verdict
  assert.equal(effectiveWaitingOn({ ai_waiting_on: "client" }, true), "client");
  assert.equal(effectiveWaitingOn({ ai_waiting_on: "staff" }, false), "staff");
  // then rule fallback
  assert.equal(effectiveWaitingOn({}, true), "staff");
  assert.equal(effectiveWaitingOn(undefined, true), "staff");
  // nothing → none
  assert.equal(effectiveWaitingOn(undefined, false), "none");
  assert.equal(effectiveWaitingOn({ ai_waiting_on: "garbage" }, false), "none");
});

test("effectiveWaitingOn: a stale verdict (new message after QA) re-opens the chat", () => {
  // She marked it «решено», but a NEW message arrived since → verdict is stale →
  // must fall back to the rule and re-open, exactly like her unread-again flow.
  assert.equal(
    effectiveWaitingOn({ human_unanswered: false }, true, /*verdictIsCurrent*/ false),
    "staff"
  );
  // Stale AI "none" with no rule hit → none (nothing to show).
  assert.equal(effectiveWaitingOn({ ai_waiting_on: "none" }, false, false), "none");
  // Verdict current again (same message) → her dismissal holds.
  assert.equal(effectiveWaitingOn({ human_unanswered: false }, true, true), "none");
});

test("sameInstant compares timestamps tolerant of formatting", () => {
  assert.equal(sameInstant("2026-06-18T10:18:02+00:00", "2026-06-18 10:18:02+00"), true);
  assert.equal(sameInstant("2026-06-18T10:18:02Z", "2026-06-18T10:18:03Z"), false);
  assert.equal(sameInstant(null, "2026-06-18T10:18:02Z"), false);
  assert.equal(sameInstant("x", "y"), false);
});

test("isResolvedWatched only for watched chats no longer waiting on us", () => {
  assert.equal(isResolvedWatched("none", true), true); // answered → verify
  assert.equal(isResolvedWatched("client", true), true); // ball in client's court
  assert.equal(isResolvedWatched("staff", true), false); // still our turn
  assert.equal(isResolvedWatched("none", false), false); // not watched
});
