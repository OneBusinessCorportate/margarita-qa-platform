import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSystemPrompt,
  formatTranscript,
  parseVerdicts,
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

test("parseVerdicts validates shape and defaults confidence", () => {
  const text = JSON.stringify({
    results: [
      { agr_no: "B-1", unanswered: true, reason: "вопрос", confidence: "high" },
      { agr_no: "B-2", unanswered: false, reason: "спасибо", confidence: "bogus" },
      { agr_no: 99, unanswered: true }, // invalid agr_no → dropped
      { unanswered: true }, // missing agr_no → dropped
    ],
  });
  const v = parseVerdicts(text);
  assert.equal(v.length, 2);
  assert.equal(v[0].agr_no, "B-1");
  assert.equal(v[1].confidence, "low"); // invalid enum coerced
});

test("parseVerdicts returns [] on non-JSON", () => {
  assert.deepEqual(parseVerdicts("not json"), []);
  assert.deepEqual(parseVerdicts("{}"), []);
});
