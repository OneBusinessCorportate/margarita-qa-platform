import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accountantsToMessage,
  buildAccountantMessage,
  buildFridayFinesMessage,
  buildReportMessage,
  buildScoreMessage,
  buildWeeklyReportMessage,
  surveyInviteAm,
  surveyInviteRu,
} from "../src/lib/templates";
import type { DailyReport } from "../src/lib/report";
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

test("violation lines: per-accountant action header + one bullet per violation (code + fine, no name)", () => {
  const report = buildReport(seedChats, seedEvaluations, {}, seedTasks, "2026-06-15");
  const msg = buildReportMessage(report, {
    violations: [
      {
        id: "1", vdate: "2026-06-15", accountant: "Լիլիթ", chat_agr_no: "B-1",
        client: "Клиент А", severity: "Критичное", violation_type: "авто из оценки",
        gross: null, sanction: 1000, note: null, created_at: "2026-06-15T10:00:00Z",
      },
      {
        id: "2", vdate: "2026-06-15", accountant: "Լիլիթ", chat_agr_no: "B-1",
        client: "Клиент А", severity: "Среднее",
        violation_type: "Незакрытый запрос клиента", gross: null,
        sanction: null, note: null, created_at: "2026-06-15T11:00:00Z",
      },
      {
        id: "3", vdate: "2026-06-15", accountant: "Ավագ", chat_agr_no: null,
        client: null, severity: "Среднее",
        violation_type: "Не отправлен запрос первичной документации", gross: null,
        sanction: 2000, note: null, created_at: "2026-06-15T12:00:00Z",
      },
      {
        id: "4", vdate: "2026-06-15", accountant: null, chat_agr_no: "B-2",
        client: "Клиент Б", severity: "Среднее",
        violation_type: "Нет расс. по первичной документации", gross: null,
        sanction: null, note: null, created_at: "2026-06-15T13:00:00Z",
      },
    ],
  });
  assert.match(msg, /Нарушения:/);
  assert.match(msg, /— Լիլիթ: Выговор/);
  // Chat code + fine amount, no client/chat name.
  assert.match(msg, /  ▸ B-1 — авто из оценки — 1 000 др/);
  assert.match(msg, /  ▸ B-1 — Незакрытый запрос клиента(?!.*др)/);
  assert.doesNotMatch(msg, /Клиент А/);
  assert.doesNotMatch(msg, /Клиент Б/);
  assert.match(msg, /— Ավագ: Предупреждение/);
  assert.match(msg, /  ▸ - — Не отправлен запрос первичной документации — 2 000 др/);
  // Unassigned violations are grouped under "-".
  assert.match(msg, /— -: Предупреждение/);
  assert.match(msg, /  ▸ B-2 — Нет расс\. по первичной документации(?!.*др)/);
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
  // Лилит: 3 средних за неделю → 1 000 др каждое (manual 1000 on one of them
  // matches the rule), итого 3 000 — sorted above Аваг (2 000 manual).
  const avag = msg.indexOf("— Ավագ:");
  const lilit = msg.indexOf("— Լիլիթ:");
  assert.ok(avag >= 0 && lilit >= 0 && lilit < avag, "sorted by weekly fine desc");
  assert.match(
    msg,
    /— Լիլիթ: 3 000 др \+ Предупреждение \(3 средних\) \/итого за месяц 7 000 драм\//
  );
  assert.match(
    msg,
    /— Ավագ: 2 000 др \+ Предупреждение \(1 среднее\) \/итого за месяц 20 000 драм\/ Не отправлен запрос первичной документации/
  );
  assert.match(msg, /Итого за неделю: 4 нарушения, штрафы 5 000 драм/);
  assert.match(msg, /Без нарушений: ✅ Գայանե, Հասմիկ/);
});

test("friday fines: money computed from the Условия rules when sanctions are empty", () => {
  const msg = buildFridayFinesMessage(
    [
      // 2 средних за неделю → 1 000 др за каждый чат
      viol({ id: "1", accountant: "Նաիրա" }),
      viol({ id: "2", accountant: "Նաիրա", vdate: "2026-07-01" }),
      // Критичное → 2 000 др
      viol({ id: "3", accountant: "Օլյա", severity: "Критичное" }),
      // 1 среднее за неделю → предупреждение, 0 др
      viol({ id: "4", accountant: "Դավիթ" }),
    ],
    { weekFrom: "2026-06-29", weekTo: "2026-07-03" }
  );
  assert.match(msg, /— Նաիրա: 2 000 др \+ Предупреждение \(2 средних\)/);
  assert.match(msg, /— Օլյա: 2 000 др \+ Выговор \(1 критичное\)/);
  // Դավիթ: single medium → warning, no money prefix
  assert.match(msg, /— Դավիթ: Предупреждение \(1 среднее\)/);
  assert.match(msg, /Итого за неделю: 4 нарушения, штрафы 4 000 драм/);
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

// --- Weekly (Friday) Armenian summary ---------------------------------------

function fakeReport(over: Partial<DailyReport>): DailyReport {
  return {
    filters: {},
    totals: {
      activeChats: 0,
      newChats: 0,
      chatsWithoutResponsible: 0,
      evaluatedChats: 0,
      unansweredChats: 0,
    },
    coveragePct: 0,
    distribution: { Отлично: 0, Хорошо: 0, Плохо: 0, Критично: 0 },
    serviceQualityPct: 0,
    perAccountant: [],
    needsAttention: [],
    criticalChats: [],
    unansweredChats: [],
    tasks: { total: 0, onTime: 0, late: 0, overdue: 0, perAccountant: [] },
    ...over,
  };
}

test("weekly report follows the Armenian Friday structure", () => {
  const previous = fakeReport({
    serviceQualityPct: 97,
    perAccountant: [
      { accountant: "Լիլիթ", avgScore: 86.6, count: 5, lowCount: 1 },
      { accountant: "Ռոբերտ", avgScore: 97.4, count: 5, lowCount: 0 },
      { accountant: "Գայանե", avgScore: 99.6, count: 5, lowCount: 0 },
    ],
  });
  const current = fakeReport({
    serviceQualityPct: 98,
    perAccountant: [
      { accountant: "Լիլիթ", avgScore: 95.0, count: 5, lowCount: 0 },
      { accountant: "Ռոբերտ", avgScore: 95.0, count: 5, lowCount: 0 },
      { accountant: "Գայանե", avgScore: 99.4, count: 5, lowCount: 0 },
    ],
    criticalChats: [
      {
        chat_agr_no: "B-1", chat_name: null, accountant: "Ռոբերտ", score: 40,
        reasons: ["Незакрытый запрос клиента"],
      },
      {
        chat_agr_no: "B-2", chat_name: null, accountant: "Լիլիթ", score: 30,
        reasons: ["Незакрытый запрос клиента"],
      },
    ],
    perDayPerAccountant: [
      { date: "2026-06-29", accountant: "Գայանե", avgScore: 100, count: 1, lowCount: 0 },
      { date: "2026-06-30", accountant: "Գայանե", avgScore: 100, count: 1, lowCount: 0 },
      { date: "2026-07-01", accountant: "Գայանե", avgScore: 98, count: 1, lowCount: 0 },
    ],
  });

  const msg = buildWeeklyReportMessage(current, previous, {
    roster: ["Գայանե", "Ռոբերտ", "Լիլիթ"],
  });

  assert.match(msg, /^1․ Անցած շաբաթվա սերվիսի որակը տոկոսներով - 97%/);
  assert.match(msg, /2․ Այս շաբաթվա սերվիսի որակը տոկոսներով - 98%/);
  assert.match(msg, /Առանցձին թիմակիցների մասով․/);
  assert.match(msg, /3․ .* - Լիլիթ 86\.60 - 95\.00/);
  assert.match(msg, /4․ .* - Ռոբերտ 97\.40 - 95\.00/);
  assert.match(msg, /5․ .*Незакрытый запрос клиента/);
  assert.match(msg, /Գայանե — 99\.60 - 99\.40/);
  assert.match(msg, /Ռոբերտ — 97\.40 - 95\.00/);
  assert.match(msg, /Լիլիթ — 86\.60 - 95\.00/);
  assert.match(msg, /շաբաթվա աստղ՝ Գայանե \/2x - 100, 1x - 98\//);
});

test("survey invites embed the typeform link with the chat id", () => {
  const chat = seedChats[0];
  assert.match(surveyInviteRu(chat), /typeform\.com/);
  assert.ok(surveyInviteRu(chat).includes(`client_id=${chat.agr_no}`));
  assert.ok(surveyInviteAm(chat).includes(`client_id=${chat.agr_no}`));
});
