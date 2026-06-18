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

test("report message leads with coverage, unanswered and critical chats", () => {
  const report = buildReport(seedChats, seedEvaluations, {}, seedTasks, "2026-06-15");
  const msg = buildReportMessage(report);
  assert.match(msg, /👁 Охват:/);
  assert.match(msg, /Без ответа клиенту:/); // the count metric
  assert.match(msg, /📭 Без ответа клиенту \(2\)/); // the detail block
  assert.match(msg, /⛔️ Критичные чаты \(2\)/);
  assert.match(msg, /проблемных:/); // distribution problem share
  // The two gated chats appear by contract number.
  assert.match(msg, /№180/);
  assert.match(msg, /№28/);
});

test("report message shows ▲/▼ trend vs the previous period", () => {
  const cur = buildReport(seedChats, seedEvaluations, {}, seedTasks);
  // Fabricate a weaker previous period so the trend is upward.
  const previous = { ...cur, serviceQualityPct: cur.serviceQualityPct - 5, filters: { from: "2026-06-09", to: "2026-06-09" } };
  const msg = buildReportMessage(cur, { previous });
  assert.match(msg, /▲ \+5 п\.п\. к 09\.06/);
});

test("report message has no trend when there is no previous period", () => {
  const cur = buildReport(seedChats, seedEvaluations, {}, seedTasks);
  const msg = buildReportMessage(cur, { previous: null });
  assert.doesNotMatch(msg, /▲|▼/);
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
