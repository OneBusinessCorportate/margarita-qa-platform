import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReportMessage, buildScoreMessage } from "../src/lib/templates";
import { buildReport } from "../src/lib/report";
import { seedChats, seedEvaluations } from "../src/lib/seed-data";

test("report message contains all the sheet metrics", () => {
  const report = buildReport(seedChats, seedEvaluations, {});
  const msg = buildReportMessage(report);
  assert.match(msg, /Активных чатов:/);
  assert.match(msg, /Новых чатов:/);
  assert.match(msg, /Чаты без ответственных:/);
  assert.match(msg, /Оценено чатов всего:/);
  assert.match(msg, /Сервис Бухгалтерии:/);
  assert.match(msg, /Отлично:/);
});

test("score message includes score, band, chat link and comment", () => {
  const ev = seedEvaluations[0];
  const chat = seedChats.find((c) => c.agr_no === ev.chat_agr_no) ?? null;
  const msg = buildScoreMessage(ev, chat);
  assert.match(msg, new RegExp(`№ ${ev.chat_agr_no}`));
  assert.match(msg, new RegExp(`${ev.total_score}%`));
  assert.match(msg, /Отлично|Хорошо|Плохо|Критично/);
  if (chat?.chat_link) assert.match(msg, new RegExp("t.me"));
  if (ev.comment) assert.ok(msg.includes(ev.comment));
});

test("score message handles missing chat gracefully", () => {
  const ev = seedEvaluations[0];
  const msg = buildScoreMessage(ev, null);
  assert.match(msg, new RegExp(ev.chat_agr_no));
});
