import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accountantsToMessage,
  buildAccountantMessage,
  buildReportMessage,
  buildScoreMessage,
  surveyInviteAm,
  surveyInviteRu,
} from "../src/lib/templates";
import { buildReport } from "../src/lib/report";
import { seedChats, seedEvaluations, seedTasks } from "../src/lib/seed-data";

test("report message contains the headline metrics + both blocks", () => {
  const report = buildReport(seedChats, seedEvaluations, {}, seedTasks);
  const msg = buildReportMessage(report);
  // The redundant sheet block (Активных/Новых/Без ответственных/Оценено) was
  // dropped at Margarita's request — coverage + service lines cover it.
  assert.doesNotMatch(msg, /^Активных чатов:/m);
  assert.doesNotMatch(msg, /^Новых чатов:/m);
  assert.doesNotMatch(msg, /^Чаты без ответственных:/m);
  assert.doesNotMatch(msg, /^Оценено чатов всего:/m);
  assert.match(msg, /👁 Охват:/);
  assert.match(msg, /Сервис Бухгалтерии:/);
  assert.match(msg, /Задачи Бухгалтерии:/);
  assert.match(msg, /Отлично:/);
});

test("report message leads with coverage and critical chats, no «без ответа»", () => {
  const report = buildReport(seedChats, seedEvaluations, {}, seedTasks, "2026-06-15");
  const msg = buildReportMessage(report);
  assert.match(msg, /👁 Охват:/);
  assert.doesNotMatch(msg, /Без ответа клиенту/); // unreliable signal removed
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

test("per-accountant message lists that person's critical chats", () => {
  const report = buildReport(seedChats, seedEvaluations, {}, seedTasks, "2026-06-15");
  const someone = report.criticalChats[0]?.accountant;
  assert.ok(someone, "seed data should have at least one critical chat with an accountant");
  const msg = buildAccountantMessage(report, someone!, { date: "2026-06-15" });
  assert.match(msg, new RegExp(`👤 ${someone}`));
  assert.match(msg, /⛔️ Критичные чаты/);
  // Only that accountant's critical chats appear.
  const others = report.criticalChats.filter((c) => c.accountant !== someone);
  for (const o of others) assert.doesNotMatch(msg, new RegExp(`№${o.chat_agr_no}\\b`));
});

test("accountantsToMessage returns people with critical chats, none empty", () => {
  const report = buildReport(seedChats, seedEvaluations, {}, seedTasks, "2026-06-15");
  const names = accountantsToMessage(report);
  const critOwners = new Set(
    report.criticalChats.map((c) => c.accountant).filter(Boolean) as string[]
  );
  for (const owner of critOwners) assert.ok(names.includes(owner));
  assert.ok(!names.includes("" as any));
});

test("survey invites embed the typeform link with the chat id", () => {
  const chat = seedChats[0];
  assert.match(surveyInviteRu(chat), /typeform\.com/);
  assert.ok(surveyInviteRu(chat).includes(`client_id=${chat.agr_no}`));
  assert.ok(surveyInviteAm(chat).includes(`client_id=${chat.agr_no}`));
});
