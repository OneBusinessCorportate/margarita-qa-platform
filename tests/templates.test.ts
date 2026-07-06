import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accountantsToMessage,
  buildAccountantMessage,
  buildFridayFinesMessage,
  buildReportMessage,
  buildScoreMessage,
  surveyInviteAm,
  surveyInviteRu,
} from "../src/lib/templates";
import type { Violation } from "../src/lib/types";
import { buildReport } from "../src/lib/report";
import { seedChats, seedEvaluations, seedTasks } from "../src/lib/seed-data";

test("report message follows the daily format", () => {
  const report = buildReport(seedChats, seedEvaluations, {}, seedTasks);
  const msg = buildReportMessage(report);
  assert.match(msg, /^Ежедневный отчет бухгалтерии/);
  assert.match(msg, /Дата: \d{2}\.\d{2}/);
  assert.match(msg, /Общий уровень сервиса: [\d.]+% по отделу/);
  // Sections dropped from the message format.
  assert.doesNotMatch(msg, /Охват/);
  assert.doesNotMatch(msg, /Результаты по бухгалтерам/);
  assert.doesNotMatch(msg, /Критичные чаты/);
  assert.doesNotMatch(msg, /Менеджеры/);
  assert.doesNotMatch(msg, /▲|▼/);
});

test("report message stars honour the roster filter", () => {
  const report = buildReport(seedChats, seedEvaluations, {}, seedTasks, "2026-06-15");
  const scored = report.perAccountant.filter((a) => a.count > 0 && a.avgScore >= 0);
  assert.ok(scored.length >= 2, "seed data should have at least two scored accountants");
  const top = [...scored].sort((a, b) => b.avgScore - a.avgScore)[0].accountant;
  const msg = buildReportMessage(report, { roster: [top] });
  assert.match(msg, /Звезда дня/);
  assert.match(msg, new RegExp(`⭐️ ${top}: [\\d.]+% оценка`));
  const droppedStar = scored.find((s) => s.accountant !== top)!.accountant;
  assert.doesNotMatch(msg, new RegExp(`⭐️ ${droppedStar}:`));
});

test("report message shows requests per day in roster order", () => {
  const report = buildReport(seedChats, seedEvaluations, {}, seedTasks, "2026-06-15");
  const msg = buildReportMessage(report, {
    requests: [
      { accountant: "Անի", count: 16 },
      { accountant: "Նաիրա", count: 20 },
      { accountant: "-", count: 50 },
    ],
    requestDays: 2,
    roster: ["Նաիրա", "Անի"],
  });
  assert.match(msg, /Кол-во запросов за день:/);
  assert.match(msg, /Նաիրա — 10\nԱնի — 8/); // roster order, per-day figures
  assert.doesNotMatch(msg, /- — 25/); // non-roster name is skipped
});

test("violation lines: day fine + action + month-to-date total + reason", () => {
  const report = buildReport(seedChats, seedEvaluations, {}, seedTasks, "2026-06-15");
  const msg = buildReportMessage(report, {
    violations: [
      {
        id: "1", vdate: "2026-06-15", accountant: "Լիլիթ", chat_agr_no: null,
        client: null, severity: "Среднее", violation_type: null, gross: null,
        sanction: 1000, note: null, created_at: "2026-06-15T10:00:00Z",
      },
      {
        id: "2", vdate: "2026-06-15", accountant: "Լիլիթ", chat_agr_no: null,
        client: null, severity: "Среднее", violation_type: null, gross: null,
        sanction: null, note: null, created_at: "2026-06-15T11:00:00Z",
      },
      {
        id: "3", vdate: "2026-06-15", accountant: "Ավագ", chat_agr_no: null,
        client: null, severity: "Среднее",
        violation_type: "Не отправлен запрос первичной документации", gross: null,
        sanction: 2000, note: null, created_at: "2026-06-15T12:00:00Z",
      },
      {
        id: "4", vdate: "2026-06-15", accountant: "Սոնա", chat_agr_no: null,
        client: null, severity: "Среднее", violation_type: null, gross: null,
        sanction: null, note: null, created_at: "2026-06-15T13:00:00Z",
      },
    ],
    monthFineTotals: { "Լիլիթ": 7000, "Ավագ": 20000 },
  });
  assert.match(msg, /Нарушения:/);
  assert.match(
    msg,
    /— Լիլիթ: 1 000 др \+ Предупреждение \(2 средних\) \/итого сумма штрафа 7 000 драм\//
  );
  assert.match(
    msg,
    /— Ավագ: 2 000 др \+ Предупреждение \(1 среднее\) \/итого сумма штрафа 20 000 драм\/ Не отправлен запрос первичной документации/
  );
  // No fines at all → no prefix, no итого tail.
  assert.match(msg, /— Սոնա: Предупреждение \(1 среднее\)(?!.*драм)/m);
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

// --- Friday fines review (пятничный отчёт) -----------------------------------

function viol(over: Partial<Violation>): Violation {
  return {
    id: "v", vdate: "2026-07-03", accountant: null, chat_agr_no: null,
    client: null, severity: "Среднее", violation_type: null, gross: null,
    sanction: null, note: null, created_at: "2026-07-03T10:00:00Z",
    ...over,
  };
}

test("friday fines message lists weekly fines with month totals and clean list", () => {
  const msg = buildFridayFinesMessage(
    [
      viol({ id: "1", accountant: "Լիլիթ", sanction: 1000 }),
      viol({ id: "2", accountant: "Լիլիթ" }),
      viol({ id: "3", accountant: "Լիլիթ" }),
      viol({
        id: "4", accountant: "Ավագ", sanction: 2000,
        violation_type: "Не отправлен запрос первичной документации",
      }),
    ],
    {
      weekFrom: "2026-06-29",
      weekTo: "2026-07-03",
      monthFineTotals: { "Լիլիթ": 7000, "Ավագ": 20000 },
      roster: ["Լիլիթ", "Ավագ", "Գայանե", "Հասմիկ"],
    }
  );
  assert.match(msg, /^Пятничный отчет по штрафам/);
  assert.match(msg, /Неделя: 29\.06 — 03\.07/);
  // Sorted by weekly fine: Аваг (2000) before Лилит (1000).
  const avag = msg.indexOf("— Ավագ:");
  const lilit = msg.indexOf("— Լիլիթ:");
  assert.ok(avag >= 0 && lilit >= 0 && avag < lilit, "sorted by weekly fine desc");
  assert.match(
    msg,
    /— Լիլիթ: 1 000 др \+ Предупреждение \(3 средних\) \/итого за месяц 7 000 драм\//
  );
  assert.match(
    msg,
    /— Ավագ: 2 000 др \+ Предупреждение \(1 среднее\) \/итого за месяц 20 000 драм\/ Не отправлен запрос первичной документации/
  );
  assert.match(msg, /Итого за неделю: 4 нарушения, штрафы 3 000 драм/);
  assert.match(msg, /Без нарушений: ✅ Գայանե, Հասմիկ/);
});

test("friday fines message with a clean week", () => {
  const msg = buildFridayFinesMessage([], {
    weekFrom: "2026-06-29",
    weekTo: "2026-07-03",
    roster: ["Գայանե"],
  });
  assert.match(msg, /На этой неделе нарушений нет ✅/);
  assert.match(msg, /Без нарушений: ✅ Գայանե/);
});

test("survey invites embed the typeform link with the chat id", () => {
  const chat = seedChats[0];
  assert.match(surveyInviteRu(chat), /typeform\.com/);
  assert.ok(surveyInviteRu(chat).includes(`client_id=${chat.agr_no}`));
  assert.ok(surveyInviteAm(chat).includes(`client_id=${chat.agr_no}`));
});
