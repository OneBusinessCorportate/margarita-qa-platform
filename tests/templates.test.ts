import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accountantsToMessage,
  buildAccountantMessage,
  buildDailyStaffViolationsMessage,
  buildFridayFinesMessage,
  buildMonthlyFinesMessage,
  buildReportMessage,
  buildScoreMessage,
  buildWeeklyFinesBreakdown,
  buildWeeklyReportMessage,
  surveyInviteAm,
  surveyInviteRu,
} from "../src/lib/templates";
import type { DailyReport } from "../src/lib/report";
import type { Violation } from "../src/lib/types";
import { buildReport } from "../src/lib/report";
import { buildLiveViolationBreakdown } from "../src/lib/violation-report";
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

test("report message groups clean accountants into ONE compact list (no «Нарушения: нет»)", () => {
  const report = buildReport(seedChats, seedEvaluations, {}, seedTasks, "2026-06-15");
  const msg = buildReportMessage(report, {
    requests: [
      { accountant: "Անի", count: 16 },
      { accountant: "Նաիրա", count: 20 },
      { accountant: "-", count: 50 },
    ],
    roster: ["Նաիրա", "Անի"],
  });
  // All roster accountants (none with violations) → one compact names list,
  // in roster order — no repeated «Нарушения: нет», no per-person counts.
  assert.match(msg, /Бухгалтеры без нарушений:\nՆաիրա, Անի/);
  assert.doesNotMatch(msg, /Нарушения: нет/);
  assert.doesNotMatch(msg, /Кол-во запросов за день/);
  assert.doesNotMatch(msg, /- — 50/); // non-roster name is skipped
});

test("violators are detailed, clean accountants are a names list (daily 0/1000 rule)", () => {
  const report = buildReport(seedChats, seedEvaluations, {}, seedTasks, "2026-06-15");
  const msg = buildReportMessage(report, {
    requests: [
      { accountant: "Լիլիթ", count: 3 },
      { accountant: "Ավագ", count: 10 },
    ],
    requestDays: 1,
    roster: ["Լիլիթ", "Ավագ"],
    violations: [
      // Same accountant/day: 1st = предупреждение (0), 2nd = 1 000.
      viol({
        id: "1", vdate: "2026-06-15", accountant: "Լիլիթ", chat_agr_no: "B-1",
        violation_type: "поздний ответ", created_at: "2026-06-15T10:00:00Z",
      }),
      viol({
        id: "2", vdate: "2026-06-15", accountant: "Լիլիթ", chat_agr_no: "B-5678",
        violation_type: "без ответа", created_at: "2026-06-15T11:00:00Z",
      }),
    ],
  });
  // Лилит is a violator → name then her two нарушения listed directly under it.
  assert.match(msg, /Бухгалтеры с нарушениями:\nԼիլիթ\n- B-1 — поздний ответ — предупреждение \/ 0 др\n- B-5678 — без ответа — 1 000 др/);
  // Аваг has no violations → in the compact clean list, never «Нарушения: нет».
  assert.match(msg, /Бухгалтеры без нарушений:\nԱվագ/);
  assert.doesNotMatch(msg, /Нарушения: нет/);
  // No client/chat name leaks into the report.
  assert.doesNotMatch(msg, /Клиент/);
  assert.match(msg, /Итого штрафов: 1 000 др/);
});

test("severity alone does NOT inflate the auto fine (0/1000), same engine as PDF", () => {
  const report = buildReport(seedChats, seedEvaluations, {}, seedTasks, "2026-06-15");
  const msg = buildReportMessage(report, {
    requests: [{ accountant: "Լիլիթ", count: 5 }],
    roster: ["Լիլիթ"],
    violations: [
      // Critical severity, NO manual sanction → 1st/day = предупреждение.
      viol({
        id: "a", vdate: "2026-06-15", accountant: "Լիլիթ", chat_agr_no: "B-1",
        severity: "Критичное", violation_type: "Грубый ответ",
        created_at: "2026-06-15T10:00:00Z",
      }),
      // 2nd of the day, no manual sanction → exactly 1 000, never 2 000.
      viol({
        id: "b", vdate: "2026-06-15", accountant: "Լիլիթ", chat_agr_no: "B-2",
        severity: "Критичное", violation_type: "Долгий ответ",
        created_at: "2026-06-15T11:00:00Z",
      }),
    ],
  });
  assert.match(msg, /- B-1 — Грубый ответ — предупреждение \/ 0 др/);
  assert.match(msg, /- B-2 — Долгий ответ — 1 000 др/);
  assert.doesNotMatch(msg, /2 000/); // severity never inflates to 2 000
  assert.match(msg, /Итого штрафов: 1 000 др/);
});

test("manual sanction OVERRIDES the auto rule and carries into the message (п.5/п.7)", () => {
  const report = buildReport(seedChats, seedEvaluations, {}, seedTasks, "2026-06-15");
  const msg = buildReportMessage(report, {
    roster: ["Լիլիթ"],
    violations: [
      viol({
        id: "a", vdate: "2026-06-15", accountant: "Լիլիթ", chat_agr_no: "B-1",
        violation_type: "Грубый ответ", sanction: 5000, created_at: "2026-06-15T10:00:00Z",
      }),
    ],
  });
  // Margarita's explicit 5 000 overrides the 0/1000 auto rule — same as PDF/dashboard.
  assert.match(msg, /5\s?000 др/);
  assert.match(msg, /Итого штрафов: 5\s?000 др/);
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
  // Лилит (все 03.07): manual 1 000 (id1) + среднее id2 (1-е за день →
  // предупреждение 0) + среднее id3 (2-е за день → 1 000) = 2 000. Аваг —
  // manual 2 000. При равном штрафе Лилит выше по числу нарушений (3 vs 1).
  const avag = msg.indexOf("— Ավագ:");
  const lilit = msg.indexOf("— Լիլիթ:");
  assert.ok(avag >= 0 && lilit >= 0 && lilit < avag, "sorted by weekly fine desc");
  assert.match(
    msg,
    /— Լիլիթ: 2 000 др \+ Предупреждение \(3 средних\) \/итого за месяц 7 000 драм\//
  );
  assert.match(
    msg,
    /— Ավագ: 2 000 др \+ Предупреждение \(1 среднее\) \/итого за месяц 20 000 драм\/ Не отправлен запрос первичной документации/
  );
  assert.match(msg, /Итого за неделю: 4 нарушения, штрафы 4 000 драм/);
  assert.match(msg, /Без нарушений: ✅ Գայանե, Հասմիկ/);
});

test("friday fines: money computed from the Условия rules when sanctions are empty", () => {
  const msg = buildFridayFinesMessage(
    [
      // 2 средних за неделю → 1 000 др за каждый чат
      viol({ id: "1", accountant: "Նաիրա" }),
      viol({ id: "2", accountant: "Նաիրա" }),
      // Критичное → 2 000 др
      viol({ id: "3", accountant: "Օլյա", severity: "Критичное" }),
      // 1 среднее за неделю → предупреждение, 0 др
      viol({ id: "4", accountant: "Դավիթ" }),
    ],
    { weekFrom: "2026-06-29", weekTo: "2026-07-03" }
  );
  assert.match(msg, /— Նաիրա: 1 000 др \+ Предупреждение \(2 средних\)/);
  assert.match(msg, /— Օլյա: Выговор \(1 критичное\)/);
  // Դավիթ: single medium → warning, no money prefix
  assert.match(msg, /— Դավիթ: Предупреждение \(1 среднее\)/);
  assert.match(msg, /Итого за неделю: 4 нарушения, штрафы 1 000 драм/);
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

// --- Monthly fines report (ежемесячный отчёт по штрафам) ---------------------

test("monthly fines message: per-person blocks with chat—problem—price and totals", () => {
  const msg = buildMonthlyFinesMessage(
    [
      // Лилит: 2 средних in the same week → 1 000 др each
      viol({ id: "1", accountant: "Լիլիթ", chat_agr_no: "B-4742", violation_type: "Долгий ответ" }),
      viol({ id: "2", accountant: "Լիլիթ", chat_agr_no: "B-5110", violation_type: "Грубый ответ" }),
      // Аваг: критичное → 2 000 др
      viol({ id: "3", accountant: "Ավագ", severity: "Критичное", chat_agr_no: "B-1234", violation_type: "Ошибка в отправленном инвойсе" }),
      // Դավիթ: single среднее in its own week → предупреждение (0 др)
      viol({ id: "4", accountant: "Դավիթ", vdate: "2026-07-10", chat_agr_no: "B-9999", violation_type: "Игнорирование задач" }),
    ],
    {
      monthFrom: "2026-07-01",
      monthTo: "2026-07-31",
      roster: ["Լիլիթ", "Ավագ", "Դավիթ", "Գայանե"],
    }
  );
  assert.match(msg, /^Ежемесячный отчет по штрафам/);
  assert.match(msg, /Месяц: 01\.07 — 31\.07/);
  // One block per person: chat code — problem — money, then the person's total.
  assert.match(msg, /— Լիլիթ:\n  ▸ B-4742 — Долгий ответ — предупреждение\n  ▸ B-5110 — Грубый ответ — 1 000 др\n  Итого: 1 000 др/);
  assert.match(msg, /— Ավագ:\n  ▸ B-1234 — Ошибка в отправленном инвойсе — предупреждение\n  Итого: 0 др/);
  assert.match(msg, /— Դավիթ:\n  ▸ B-9999 — Игнорирование задач — предупреждение\n  Итого: 0 др/);
  // Biggest fine first: Лилит (2 000) before Դավիթ (0).
  const davit = msg.indexOf("— Դավիթ:");
  const lilit = msg.indexOf("— Լիլիթ:");
  assert.ok(lilit >= 0 && davit >= 0 && lilit < davit, "sorted by monthly fine desc");
  // Grand totals + the final fine line.
  assert.match(msg, /Сумма всех штрафов: 1 000 др/);
  assert.match(msg, /Финальный штраф: 1 000 др/);
  assert.match(msg, /Без нарушений: ✅ Գայանե/);
});

test("monthly fines message: показывает название чата рядом с номером договора", () => {
  // Запрос QA: в строке должно быть не только «B-4676», но и название чата, чтобы
  // бухгалтер сразу узнал, о каком чате речь.
  const msg = buildMonthlyFinesMessage(
    [
      viol({
        id: "1",
        accountant: "Լիլիթ",
        chat_agr_no: "B-4676",
        client: "ООО Ромашка",
        violation_type: "Незакрытый запрос клиента, ощущения незавершенной работы",
      }),
    ],
    { monthFrom: "2026-07-01", monthTo: "2026-07-31" }
  );
  assert.match(
    msg,
    /▸ B-4676 \(ООО Ромашка\) — Незакрытый запрос клиента, ощущения незавершенной работы — предупреждение/
  );
});

test("monthly fines message: manual sanction wins and clean month is celebrated", () => {
  const withManual = buildMonthlyFinesMessage(
    [viol({ id: "1", accountant: "Նաիրա", chat_agr_no: "B-1", violation_type: "Долгий ответ", sanction: 5000 })],
    { monthFrom: "2026-07-01", monthTo: "2026-07-31" }
  );
  assert.match(withManual, /▸ B-1 — Долгий ответ — 5 000 др/);
  assert.match(withManual, /Финальный штраф: 5 000 др/);

  const clean = buildMonthlyFinesMessage([], {
    monthFrom: "2026-07-01",
    monthTo: "2026-07-31",
    roster: ["Գայանե"],
  });
  assert.match(clean, /В этом месяце нарушений нет ✅/);
  assert.match(clean, /Без нарушений: ✅ Գայանե/);
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
    },
    coveragePct: 0,
    distribution: { Отлично: 0, Хорошо: 0, Плохо: 0, Критично: 0 },
    serviceQualityPct: 0,
    perAccountant: [],
    needsAttention: [],
    criticalChats: [],
    tasks: { total: 0, onTime: 0, late: 0, overdue: 0, perAccountant: [], items: [] },
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
        chat_agr_no: "B-1", chat_name: null, accountant: "Ռոբերտ", manager: null, score: 40,
        reasons: ["Незакрытый запрос клиента"],
      },
      {
        chat_agr_no: "B-2", chat_name: null, accountant: "Լիלիթ", manager: null, score: 30,
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

// --- Weekly per-accountant fines breakdown (для ежедневного отчёта) ----------

test("weekly fines breakdown: 2 проблемы в одном чате = ОДНО нарушение (за каждый чат)", () => {
  // Каждый чат встречается дважды (среднее + критичное). По «Условия» это ОДНО
  // нарушение на чат — худшая тяжесть (критичное), штраф один раз (2 000 др), а
  // не 1 000 + 2 000. Два разных чата → 2 нарушения × 2 000 = 4 000, не 6 000.
  const msg = buildWeeklyFinesBreakdown(
    [
      viol({ id: "1", accountant: "Դավիթ", chat_agr_no: "B-4783", violation_type: "Отсутствие письменной фиксации договоренностей" }),
      viol({ id: "2", accountant: "Դավիթ", chat_agr_no: "B-4783", severity: "Критичное", violation_type: null }),
      viol({ id: "3", accountant: "Դավիթ", chat_agr_no: "B-4282", violation_type: "Нет расс. по первичной документации" }),
      viol({ id: "4", accountant: "Դավիթ", chat_agr_no: "B-4282", severity: "Критичное", violation_type: null }),
    ],
    { weekFrom: "2026-07-06", weekTo: "2026-07-08" }
  );
  assert.match(msg, /^Нарушения за неделю \(06\.07 — 08\.07\):/);
  assert.match(msg, /— Դավիթ:/);
  assert.match(msg, /▸ B-4783 — Отсутствие письменной фиксации договоренностей — предупреждение/);
  assert.match(msg, /▸ B-4282 — Нет расс\. по первичной документации — 1 000 др/);
  assert.match(msg, /Итого: 1 000 др/);
});

test("weekly fines breakdown: показывает название чата рядом с номером договора", () => {
  const msg = buildWeeklyFinesBreakdown(
    [
      viol({
        id: "1",
        accountant: "Դավիթ",
        chat_agr_no: "B-4676",
        client: "ООО Ромашка",
        violation_type: "Незакрытый запрос клиента, ощущения незавершенной работы",
      }),
    ],
    { weekFrom: "2026-07-06", weekTo: "2026-07-08" }
  );
  assert.match(
    msg,
    /▸ B-4676 \(ООО Ромашка\) — Незакрытый запрос клиента, ощущения незавершенной работы — предупреждение/
  );
});

test("weekly fines breakdown: пусто, если нарушений нет", () => {
  assert.equal(
    buildWeeklyFinesBreakdown([], { weekFrom: "2026-07-06", weekTo: "2026-07-08" }),
    ""
  );
});

test("weekly fines breakdown: с ростером показывает ВСЕХ сотрудников", () => {
  const msg = buildWeeklyFinesBreakdown(
    [
      viol({ id: "1", accountant: "Դավիթ", chat_agr_no: "B-4783", violation_type: "Отсутствие письменной фиксации договоренностей" }),
      viol({ id: "2", accountant: "Դավիթ", chat_agr_no: "B-4783", severity: "Критичное", violation_type: null }),
    ],
    {
      weekFrom: "2026-07-06",
      weekTo: "2026-07-08",
      roster: ["Դավիթ", "Օլյա", "Ավագ"],
    }
  );
  // Один чат с двумя проблемами — ОДНО нарушение (худшая тяжесть — критичное → 2 000).
  assert.match(msg, /— Դավիթ:/);
  assert.match(msg, /▸ B-4783 — Отсутствие письменной фиксации договоренностей — предупреждение/);
  assert.match(msg, /Итого: 0 др/);
  // Остальные сотрудники ростера — строкой «без нарушений».
  assert.match(msg, /— Օլյա: без нарушений/);
  assert.match(msg, /— Ավագ: без нарушений/);
});

test("weekly fines breakdown: с ростером и без нарушений — все «без нарушений»", () => {
  const msg = buildWeeklyFinesBreakdown([], {
    weekFrom: "2026-07-06",
    weekTo: "2026-07-08",
    roster: ["Դավիթ", "Օլյա"],
  });
  assert.match(msg, /^Нарушения за неделю \(06\.07 — 08\.07\):/);
  assert.match(msg, /— Դավիթ: без нарушений/);
  assert.match(msg, /— Օլյա: без нарушений/);
});

// --- Ежедневный отчёт по нарушениям ПО КАЖДОМУ СОТРУДНИКУ ---------------------

test("daily staff report: только ручные нарушения; сотрудники с 0 нарушений скрыты (п.5/п.9/п.12)", () => {
  const violations: Violation[] = [
    viol({
      id: "1", vdate: "2026-07-10", accountant: "Լիլիթ", chat_agr_no: "B-1",
      client: "Клиент А", severity: "Критичное", violation_type: "Грубый ответ",
      note: "проверить срочно", confirmed: true,
    }),
    viol({
      id: "2", vdate: "2026-07-10", accountant: "Լիլիթ", chat_agr_no: "B-2",
      client: "Клиент Б", severity: "Среднее", violation_type: "Долгий ответ",
      confirmed: false,
    }),
  ];
  const breakdown = buildLiveViolationBreakdown(violations, ["Լիլիթ", "Ավագ", "Գայանե"]);
  const msg = buildDailyStaffViolationsMessage(breakdown, {
    date: "2026-07-10",
    managerByChat: { "B-1": "manager_onebusiness", "B-2": null },
  });

  assert.match(msg, /^Ежедневный отчёт по нарушениям \(по сотрудникам\)/);
  assert.match(msg, /Дата: 10\.07\.2026/);
  assert.match(msg, /Լիլիթ Խոսրովյան — 1 нарушение/);
  assert.match(msg, /Клиент: Клиент А \(B-1\)/);
  assert.match(msg, /Комментарий: проверить срочно/);
  assert.match(msg, /Менеджер: manager_onebusiness/);
  assert.ok(!/Клиент Б/.test(msg), "неподтверждённая запись не должна выводиться");
  assert.ok(!/не подтверждено/.test(msg), "статуса «не подтверждено» больше не бывает");
  assert.ok(!/Ավագ/.test(msg), "сотрудник без нарушений не должен выводиться");
  assert.ok(!/Գայанե/.test(msg), "сотрудник без нарушений не должен выводиться");
});

test("daily staff report: общий пустой статус, когда нарушений нет (п.9)", () => {
  const breakdown = buildLiveViolationBreakdown([], ["Լիլիթ", "Ավագ"]);
  const msg = buildDailyStaffViolationsMessage(breakdown, { date: "2026-07-10" });
  assert.match(msg, /Нет нарушений за выбранный период/);
  assert.ok(!/Լիլիթ/.test(msg));
});

test("report: no evaluations → «Общий уровень сервиса» shows «—», not «0%»", () => {
  // Пустой период (нет проверок) не должен читаться как 0% сервиса (жалоба
  // Маргариты: «0% не соответствует фактическим данным»).
  const report = fakeReport({ serviceQualityPct: 0 }); // totals.evaluatedChats = 0
  const msg = buildReportMessage(report);
  assert.match(msg, /Общий уровень сервиса: — \(нет проверок за период\)/);
  assert.doesNotMatch(msg, /Общий уровень сервиса: 0% по отделу/);
});

test("report: per-accountant QA-checked chats listed; critical violation drops the accountant from «Звезда дня»", () => {
  const report = fakeReport({
    totals: { activeChats: 10, newChats: 0, chatsWithoutResponsible: 0, evaluatedChats: 5 },
    serviceQualityPct: 100,
    perAccountant: [
      { accountant: "Тагуи", avgScore: 100, count: 3, chatsChecked: 3, lowCount: 0, critCount: 0 },
      { accountant: "Лилит", avgScore: 100, count: 2, chatsChecked: 2, lowCount: 0, critCount: 0 },
    ],
  });
  const violations = [
    {
      id: "v1", vdate: "2026-07-16", accountant: "Тагуи", chat_agr_no: "B-1",
      client: "Client 1", severity: "Критичное", violation_type: "Незакрытый запрос",
      sanction: 0, note: "недопонимание", confirmed: true, appeal_status: null, gross: false,
    },
  ] as unknown as Violation[];
  const msg = buildReportMessage(report, { violations, roster: ["Тагуи", "Лилит"] });

  // 1) Per-accountant checked chats surfaced (was missing entirely).
  assert.match(msg, /Проверено чатов \(QA\):/);
  assert.match(msg, /- Тагуи: 3/);
  assert.match(msg, /- Лилит: 2/);

  // 2) Тагуи has a confirmed critical violation → она НЕ «звезда дня» даже с
  //    оценкой 100 (баг про Тагуи). Лилит (чисто, 100) — звезда.
  const beforeViolators = msg.split("Бухгалтеры с нарушениями")[0];
  const starsBlock = beforeViolators.split("Звезда дня")[1] ?? "";
  assert.doesNotMatch(starsBlock, /Тагуи/);
  assert.match(starsBlock, /Лилит/);

  // 3) Тагуи под нарушителями, с её комментарием.
  assert.match(msg, /Бухгалтеры с нарушениями:/);
  assert.match(msg, /💬 недопонимание/);
});
