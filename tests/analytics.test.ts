import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAnalytics, MIN_CHATS_FOR_RANKING } from "../src/lib/analytics";
import { buildPeriodSummaryMessage } from "../src/lib/templates";
import type { Evaluation, Violation, ViolationAppeal } from "../src/lib/types";

function ev(
  accountant: string,
  chat: string,
  date: string,
  total: number
): Evaluation {
  return {
    id: `${chat}-${date}`,
    chat_agr_no: chat,
    period: date.slice(0, 7).replace("-", ""),
    checking_date: date,
    role: "accountant",
    accountant,
    scores: {},
    total_score: total,
    quality_band: "Хорошо",
    comment: null,
    created_at: `${date}T10:00:00Z`,
  } as Evaluation;
}

function vio(accountant: string, date: string, confirmed = true): Violation {
  return {
    id: `v-${accountant}-${date}-${Math.random()}`,
    vdate: date,
    accountant,
    chat_agr_no: "B-1",
    client: null,
    severity: "Среднее",
    violation_type: "тест",
    gross: null,
    sanction: null,
    note: null,
    confirmed,
    appeal_status: null,
    status: "new",
    acknowledged_at: null,
    acknowledged_by: null,
    created_at: `${date}T10:00:00Z`,
  } as Violation;
}

function appeal(
  accountant: string,
  date: string,
  status: "pending" | "approved" | "rejected"
): ViolationAppeal {
  return {
    id: `a-${accountant}-${date}-${Math.random()}`,
    violation_id: "v-1",
    accountant,
    appeal_text: "текст",
    status,
    decision_comment: null,
    resolved_by: null,
    created_at: `${date}T12:00:00Z`,
    resolved_at: null,
  } as ViolationAppeal;
}

// Реальные короткие армянские имена (резолвятся через valid-employees).
const LILIT = "Լիլիթ";
const DAVIT = "Դավիթ";
const TAGUHI = "Թագուհի";

test("aggregates per-accountant scores, chats and bands from real evaluations", () => {
  const evals = [
    ev(LILIT, "B-1", "2026-07-01", 100),
    ev(LILIT, "B-2", "2026-07-02", 80),
    ev(LILIT, "B-1", "2026-07-03", 60), // re-check другого дня — отдельная строка
    ev(DAVIT, "B-9", "2026-07-01", 40), // критично
  ];
  const r = buildAnalytics({ evaluations: evals, violations: [], appeals: [], from: "2026-07-01", to: "2026-07-31" });

  const lilit = r.perAccountant.find((a) => a.accountant.startsWith("Լիլիթ"))!;
  assert.equal(lilit.evaluations, 3);
  assert.equal(lilit.chatsChecked, 2); // B-1 дважды = 1 уникальный + B-2
  assert.equal(lilit.avgScore, 80); // (100+80+60)/3
  assert.equal(lilit.excellent, 1); // 100
  assert.equal(lilit.good, 1); // 80
  assert.equal(lilit.warnings, 1); // 60 → Плохо
  assert.equal(lilit.critical, 0);

  const davit = r.perAccountant.find((a) => a.accountant.startsWith("Դավիթ"))!;
  assert.equal(davit.critical, 1); // 40 → Критично
});

test("totals match the sum of the underlying data", () => {
  const evals = [
    ev(LILIT, "B-1", "2026-07-01", 90),
    ev(DAVIT, "B-2", "2026-07-01", 70),
  ];
  const violations = [vio(LILIT, "2026-07-01"), vio(LILIT, "2026-07-01"), vio(DAVIT, "2026-07-02")];
  const appeals = [appeal(LILIT, "2026-07-01", "approved"), appeal(DAVIT, "2026-07-02", "rejected")];
  const r = buildAnalytics({ evaluations: evals, violations, appeals, from: "2026-07-01", to: "2026-07-31" });

  assert.equal(r.totals.evaluations, 2);
  assert.equal(r.totals.chatsChecked, 2);
  assert.equal(r.totals.accountantsReviewed, 2);
  assert.equal(r.totals.avgScore, 80); // (90+70)/2
  assert.equal(r.totals.violations, 3);
  assert.equal(r.totals.appeals, 2);
  assert.equal(r.totals.appealsApproved, 1);
  assert.equal(r.totals.appealsRejected, 1);

  // Сумма per-accountant совпадает с totals (согласованность цифр).
  const sumViol = r.perAccountant.reduce((s, a) => s + a.violations, 0);
  const sumAppeals = r.perAccountant.reduce((s, a) => s + a.appeals, 0);
  assert.equal(sumViol, r.totals.violations);
  assert.equal(sumAppeals, r.totals.appeals);
});

test("unconfirmed violations and out-of-window rows are excluded", () => {
  const evals = [ev(LILIT, "B-1", "2026-07-05", 90)];
  const violations = [
    vio(LILIT, "2026-07-05", true),
    vio(LILIT, "2026-07-05", false), // авто/легаси — не считается
    vio(LILIT, "2026-08-01", true), // вне окна
  ];
  const r = buildAnalytics({ evaluations: evals, violations, appeals: [], from: "2026-07-01", to: "2026-07-31" });
  assert.equal(r.totals.violations, 1);
});

test("per-day-per-accountant preserves daily historical breakdown", () => {
  const evals = [
    ev(LILIT, "B-1", "2026-07-01", 100),
    ev(LILIT, "B-2", "2026-07-02", 50),
  ];
  const r = buildAnalytics({ evaluations: evals, violations: [], appeals: [], from: "2026-07-01", to: "2026-07-02" });
  const day1 = r.perDayPerAccountant.find((d) => d.date === "2026-07-01")!;
  const day2 = r.perDayPerAccountant.find((d) => d.date === "2026-07-02")!;
  assert.equal(day1.avgScore, 100);
  assert.equal(day2.avgScore, 50);
  assert.equal(day2.critical, 1); // 50 → Критично на второй день
  // Разные дни не перезаписывают друг друга.
  assert.equal(r.perDay.length, 2);
});

test("ranking by score ignores accountants below the small-sample threshold", () => {
  // Давит: 1 отличный чат (< порога) — не должен стать «лучшим».
  // Лилит: достаточно чатов, средняя ниже — но именно она ранжируется.
  const evals: Evaluation[] = [ev(DAVIT, "B-99", "2026-07-01", 100)];
  for (let i = 0; i < MIN_CHATS_FOR_RANKING; i++) {
    evals.push(ev(LILIT, `B-${i}`, "2026-07-01", 85));
  }
  const r = buildAnalytics({ evaluations: evals, violations: [], appeals: [], from: "2026-07-01", to: "2026-07-31" });
  assert.equal(r.rankings.topByScore?.accountant.startsWith("Լիլիթ"), true);
  const davit = r.perAccountant.find((a) => a.accountant.startsWith("Դավիթ"))!;
  assert.equal(davit.lowSample, true);
});

test("mostChats and mostViolations rankings reflect volume", () => {
  const evals = [
    ev(LILIT, "B-1", "2026-07-01", 90),
    ev(LILIT, "B-2", "2026-07-01", 90),
    ev(DAVIT, "B-3", "2026-07-01", 90),
  ];
  const violations = [vio(DAVIT, "2026-07-01"), vio(DAVIT, "2026-07-01")];
  const r = buildAnalytics({ evaluations: evals, violations, appeals: [], from: "2026-07-01", to: "2026-07-31" });
  assert.equal(r.rankings.mostChats?.accountant.startsWith("Լիլիթ"), true);
  assert.equal(r.rankings.mostChats?.value, 2);
  assert.equal(r.rankings.mostViolations?.accountant.startsWith("Դավիթ"), true);
  assert.equal(r.rankings.mostViolations?.value, 2);
});

test("empty period yields empty report, not a crash", () => {
  const r = buildAnalytics({ evaluations: [], violations: [], appeals: [], from: "2026-07-01", to: "2026-07-31" });
  assert.equal(r.totals.evaluations, 0);
  assert.equal(r.totals.avgScore, -1);
  assert.equal(r.perAccountant.length, 0);
  assert.equal(r.rankings.topByScore, null);
});

test("period summary message matches the required concise format", () => {
  const evals: Evaluation[] = [];
  for (let i = 0; i < 5; i++) evals.push(ev(TAGUHI, `T-${i}`, "2026-07-10", 96));
  for (let i = 0; i < 4; i++) evals.push(ev(LILIT, `L-${i}`, "2026-07-10", 61));
  const violations = [vio(LILIT, "2026-07-10"), vio(LILIT, "2026-07-10")];
  const appeals = [appeal(LILIT, "2026-07-10", "approved"), appeal(LILIT, "2026-07-10", "rejected")];
  const r = buildAnalytics({ evaluations: evals, violations, appeals, from: "2026-07-01", to: "2026-07-31" });
  const msg = buildPeriodSummaryMessage(r);

  assert.match(msg, /^Отчёт по QA за 01\.07\.2026–31\.07\.2026/);
  assert.match(msg, /Проверено бухгалтеров: 2/);
  assert.match(msg, /Проверено чатов: 9/);
  assert.match(msg, /Средняя оценка: \d+/);
  assert.match(msg, /Лучший результат:/);
  assert.match(msg, /Требуют внимания:/);
  assert.match(msg, /Нарушения: 2/);
  assert.match(msg, /Апелляции: 2/);
  assert.match(msg, /Подтверждено: 1/);
  assert.match(msg, /Отклонено: 1/);
});

test("period summary handles a period with no QA checks", () => {
  const r = buildAnalytics({ evaluations: [], violations: [], appeals: [], from: "2026-07-01", to: "2026-07-31" });
  const msg = buildPeriodSummaryMessage(r);
  assert.match(msg, /проверок QA не было/);
});
