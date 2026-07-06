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

test("report message contains the headline metrics", () => {
  const report = buildReport(seedChats, seedEvaluations, {}, seedTasks);
  const msg = buildReportMessage(report);
  assert.match(msg, /📊 Аналитика качества бухгалтерии/);
  assert.match(msg, /🏆 Сервис Бухгалтерии:/);
  assert.match(msg, /👁 Охват:/);
  // New simplified format does not include the distribution line or task roster.
  assert.doesNotMatch(msg, /Отлично: \d+/);
  assert.doesNotMatch(msg, /Задачи Бухгалтерии:/);
});

test("report message shows coverage and accountant results, no critical-chat block", () => {
  const report = buildReport(seedChats, seedEvaluations, {}, seedTasks, "2026-06-15");
  const msg = buildReportMessage(report);
  assert.match(msg, /👁 Охват:/);
  assert.doesNotMatch(msg, /Без ответа клиенту/);
  assert.doesNotMatch(msg, /проблемных:/);
  // Full accountant roster is shown.
  assert.match(msg, /👥 Результаты по бухгалтерам:/);
  // The detailed critical-chat list lives in the PDF now, not in the message.
  assert.doesNotMatch(msg, /⛔️ Критичные чаты/);
});

test("report message people sections honour the roster filter", () => {
  const report = buildReport(seedChats, seedEvaluations, {}, seedTasks, "2026-06-15");
  const scored = report.perAccountant.filter((a) => a.count > 0 && a.avgScore >= 0);
  assert.ok(scored.length >= 2, "seed data should have at least two scored accountants");
  const kept = scored[0].accountant;
  const dropped = scored[1].accountant;
  const msg = buildReportMessage(report, { roster: [kept] });
  assert.match(msg, new RegExp(`${kept}: `));
  assert.doesNotMatch(msg, new RegExp(`${dropped}: `));
});

test("report message shows requests per day for roster accountants", () => {
  const report = buildReport(seedChats, seedEvaluations, {}, seedTasks, "2026-06-15");
  const msg = buildReportMessage(report, {
    requests: [
      { accountant: "Անի", count: 198 },
      { accountant: "-", count: 50 },
    ],
    requestDays: 2,
    roster: ["Անի"],
  });
  assert.match(msg, /📨 Кол-во запросов за день:/);
  assert.match(msg, /Անի — 99/); // 198 over 2 days
  assert.doesNotMatch(msg, /- — 25/); // non-roster name is skipped
});

test("report message groups violations with severity counts and fine totals", () => {
  const report = buildReport(seedChats, seedEvaluations, {}, seedTasks, "2026-06-15");
  const msg = buildReportMessage(report, {
    violations: [
      {
        id: "1", vdate: "2026-06-15", accountant: "Լիլիթ", chat_agr_no: null,
        client: null, severity: "Среднее", violation_type: null, gross: null,
        sanction: 10000, note: null, created_at: "2026-06-15T10:00:00Z",
      },
      {
        id: "2", vdate: "2026-06-15", accountant: "Լիլիթ", chat_agr_no: null,
        client: null, severity: "Среднее", violation_type: null, gross: null,
        sanction: null, note: null, created_at: "2026-06-15T11:00:00Z",
      },
    ],
  });
  assert.match(msg, /Нарушения:/);
  assert.match(msg, /— Լիլիթ: Предупреждение \(2 средних\) \/итого сумма штрафа 10 000 драм\//);
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
