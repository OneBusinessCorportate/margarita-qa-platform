import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildReportMessage,
  buildScoreMessage,
  surveyInviteAm,
  surveyInviteRu,
} from "../src/lib/templates";
import { buildReport } from "../src/lib/report";
import { seedChats, seedEvaluations, seedTasks } from "../src/lib/seed-data";

test("report message contains the sheet metrics + both blocks", () => {
  const report = buildReport(seedChats, seedEvaluations, {}, seedTasks);
  const msg = buildReportMessage(report);
  assert.match(msg, /Активных чатов:/);
  assert.match(msg, /Новых чатов:/);
  assert.match(msg, /Чаты без ответственных:/);
  assert.match(msg, /Оценено чатов всего:/);
  assert.match(msg, /Сервис Бухгалтерии:/);
  assert.match(msg, /Задачи Бухгалтерии:/);
  assert.match(msg, /Отлично:/);
});

test("score message includes overall, band, monthly statuses and link", () => {
  const ev = seedEvaluations[0];
  const chat = seedChats.find((c) => c.agr_no === ev.chat_agr_no) ?? null;
  const msg = buildScoreMessage(ev, chat);
  assert.match(msg, new RegExp(`№ ${ev.chat_agr_no}`));
  assert.match(msg, new RegExp(`Общая оценка: ${ev.total_score}%`));
  assert.match(msg, /Отлично|Хорошо|Плохо|Критично/);
  if (chat?.chat_link) assert.match(msg, /t\.me|telegram/);
});

test("score message handles missing chat gracefully", () => {
  const msg = buildScoreMessage(seedEvaluations[0], null);
  assert.match(msg, new RegExp(seedEvaluations[0].chat_agr_no));
});

test("survey invites embed the typeform link with the chat id", () => {
  const chat = seedChats[0];
  assert.match(surveyInviteRu(chat), /typeform\.com/);
  assert.ok(surveyInviteRu(chat).includes(`client_id=${chat.agr_no}`));
  assert.ok(surveyInviteAm(chat).includes(`client_id=${chat.agr_no}`));
});
