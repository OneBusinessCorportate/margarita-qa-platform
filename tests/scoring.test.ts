import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BANDS,
  CRITERIA,
  DAILY_CRITERIA,
  FAIL_SCORE,
  GREETING_ACCURACY_CAP,
  KPI_CRITERIA,
  MONTHLY_CATEGORIES,
  REGISTRATION_PENALTIES,
  REGISTRATION_START,
  SCHEMES,
  STALE_ACTIVITY_DAYS,
  bandFor,
  cappedAccuracy,
  computeKpiScore,
  computeOverall,
  computeRegistrationScore,
  computeWeightedTotal,
  daysBetween,
  isMailingFail,
  isStaleActivity,
  isTaskClosed,
  isTaskDue,
  isNonWorkingDay,
  isoWeekLabel,
  kpiBonusEligible,
  mondayOf,
  reviewDayForActivity,
  reviewDayOf,
} from "../src/lib/scoring";

test("two criteria, weights 50/50 summing to 100", () => {
  assert.equal(CRITERIA.length, 2);
  assert.deepEqual(CRITERIA.map((c) => c.weight), [50, 50]);
  assert.deepEqual(DAILY_CRITERIA.map((c) => c.id), ["accuracy", "sla"]);
});

test("computeWeightedTotal = score × 50 ÷ 5 per criterion", () => {
  assert.equal(computeWeightedTotal({ accuracy: 5, sla: 5 }), 100);
  assert.equal(computeWeightedTotal({ accuracy: 0, sla: 0 }), 0);
  // 4*50/5 + 3*50/5 = 40 + 30 = 70
  assert.equal(computeWeightedTotal({ accuracy: 4, sla: 3 }), 70);
});

test("computeOverall: un-entered criteria count as full marks", () => {
  assert.equal(computeOverall({ accuracy: 5, sla: 5 }), 100);
  assert.equal(computeOverall({}), 100);
  assert.equal(computeOverall({ accuracy: 4, sla: 5 }), 90);
  assert.equal(computeOverall({ accuracy: 0, sla: 0 }), 0);
});

test("HARD GATE: a failing mailing forces the score to 1", () => {
  const perfect = { accuracy: 5, sla: 5 };
  assert.equal(computeOverall(perfect, { main_taxes: { status: "Не отправил" } }), FAIL_SCORE);
  assert.equal(computeOverall(perfect, { salary: { status: "Не запросил 1" } }), 1);
  assert.equal(computeOverall(perfect, { salary: { status: "Не запросил 2" } }), 1);
  assert.equal(computeOverall(perfect, { primary_docs: { status: "Не запросил 1" } }), 1);
  assert.equal(computeOverall(perfect, { debts: { status: "Не написал 1" } }), 1);
  assert.equal(computeOverall(perfect, { debts: { status: "Не написал 2" } }), 1);
});

test("non-failing statuses do NOT gate the score", () => {
  const perfect = { accuracy: 5, sla: 5 };
  assert.equal(computeOverall(perfect, { salary: { status: "Запросил 1, не получил" } }), 100);
  assert.equal(computeOverall(perfect, { main_taxes: { status: "Отправил" } }), 100);
  assert.equal(computeOverall(perfect, { main_taxes: { status: "Предстоящая" } }), 100);
  assert.equal(computeOverall(perfect, { main_taxes: { status: "Inactive" } }), 100);
  assert.equal(computeOverall(perfect, { debts: { status: "Нет долга" } }), 100);
});

test("isMailingFail detects any failing mailing", () => {
  assert.equal(isMailingFail({ debts: { status: "1-й написал" } }), false);
  assert.equal(isMailingFail({ debts: { status: "Не написал 2" } }), true);
  assert.equal(isMailingFail(undefined), false);
});

test("bandFor maps boundaries; a gated 1 is Критично", () => {
  assert.equal(bandFor(100), "Отлично");
  assert.equal(bandFor(90), "Отлично");
  assert.equal(bandFor(89), "Хорошо");
  assert.equal(bandFor(80), "Хорошо");
  assert.equal(bandFor(79), "Плохо");
  assert.equal(bandFor(60), "Плохо");
  assert.equal(bandFor(59), "Критично");
  assert.equal(bandFor(1), "Критично");
});

test("four mailing categories with correct due days and fail statuses", () => {
  assert.equal(MONTHLY_CATEGORIES.length, 4);
  const byId = Object.fromEntries(MONTHLY_CATEGORIES.map((c) => [c.id, c]));
  assert.equal(byId.main_taxes.dueDay, 15);
  assert.equal(byId.salary.dueDay, 10);
  assert.equal(byId.primary_docs.dueDay, 28);
  assert.equal(byId.debts.dueDay, 5);
  assert.ok(byId.main_taxes.failStatuses.includes("Не отправил"));
  assert.ok(byId.debts.statuses.includes("1-й позвонил"));
  assert.ok(byId.debts.statuses.includes("Нет долга"));
});

test("bands cover 1..100 with no gaps", () => {
  for (let n = 1; n <= 100; n++) {
    const def = BANDS.find((b) => b.band === bandFor(n))!;
    assert.ok(n >= def.min && n <= def.max, `score ${n}`);
  }
});

test("GREETING RULE: no greeting caps Точность at 4 (small, non-critical)", () => {
  // Greeting fine (or unknown) → full marks.
  assert.equal(cappedAccuracy(5, "yes"), 5);
  assert.equal(cappedAccuracy(5, undefined), 5);
  // No greeting → accuracy can't exceed 4; lower scores untouched.
  assert.equal(cappedAccuracy(5, "no"), GREETING_ACCURACY_CAP);
  assert.equal(cappedAccuracy(3, "no"), 3);
});

test("computeOverall applies the greeting cap to accuracy only", () => {
  // Perfect 5/5 = 100, but no greeting caps accuracy to 4 → 4*10 + 50 = 90.
  assert.equal(computeOverall({ accuracy: 5, sla: 5 }, undefined, CRITERIA, "no"), 90);
  // Greeting present → unaffected.
  assert.equal(computeOverall({ accuracy: 5, sla: 5 }, undefined, CRITERIA, "yes"), 100);
  // SLA is never capped by greeting.
  assert.equal(computeOverall({ accuracy: 3, sla: 5 }, undefined, CRITERIA, "no"), 80);
  // Un-entered accuracy defaults to 5 → capped to 4 when greeting missing.
  assert.equal(computeOverall({ sla: 5 }, undefined, CRITERIA, "no"), 90);
});

test("greeting cap never overrides the hard mailing gate", () => {
  assert.equal(
    computeOverall({ accuracy: 5, sla: 5 }, { salary: { status: "Не запросил 1" } }, CRITERIA, "no"),
    FAIL_SCORE
  );
});

test("daysBetween counts whole days (date-only)", () => {
  assert.equal(daysBetween("2026-06-11", "2026-06-15"), 4);
  assert.equal(daysBetween("2026-06-15", "2026-06-15"), 0);
  assert.equal(daysBetween("2026-06-15T23:59:00Z", "2026-06-16T00:01:00Z"), 1);
});

test("isStaleActivity flags chats quiet longer than the window", () => {
  const asOf = "2026-06-15";
  assert.equal(isStaleActivity("2026-06-14", asOf), false); // 1 day
  assert.equal(isStaleActivity("2026-06-11", asOf), 4 > STALE_ACTIVITY_DAYS); // 4 days
  assert.equal(isStaleActivity("2026-05-28", asOf), true); // weeks
  assert.equal(isStaleActivity(null, asOf), true); // never any activity
});

// --- Alternate schemes -----------------------------------------------------

test("evaluation schemes are registered", () => {
  assert.deepEqual(SCHEMES.map((s) => s.id), [
    "accounting",
    "accounting_kpi",
    "registration",
    "kk_quality",
  ]);
});

test("registration: start 100, subtract penalty points per incident", () => {
  const byId = Object.fromEntries(REGISTRATION_PENALTIES.map((p) => [p.id, p]));
  assert.equal(REGISTRATION_START, 100);
  assert.equal(byId.critical.points, -40);
  assert.equal(byId.speed.points, -50);
  assert.equal(byId.feedback.points, -10);
  // No incidents → full 100.
  assert.equal(computeRegistrationScore({}), 100);
  // One critical (−40) → 60 (Плохо).
  assert.equal(computeRegistrationScore({ critical: 1 }), 60);
  assert.equal(bandFor(computeRegistrationScore({ critical: 1 })), "Плохо");
  // One late answer (−50) → 50 (Критично).
  assert.equal(computeRegistrationScore({ speed: 1 }), 50);
  // Mixed, counts multiply: 2×−10 + 1×−40 = −60 → 40.
  assert.equal(computeRegistrationScore({ feedback: 2, critical: 1 }), 40);
  // Floored at 0, never negative.
  assert.equal(computeRegistrationScore({ critical: 3 }), 0);
});

test("KPI: Уведомл×30% + CSAT×40% + Чаты×30% (sheet-verified)", () => {
  assert.deepEqual(KPI_CRITERIA.map((c) => c.weight), [30, 40, 30]);
  // Perfect → 100.
  assert.equal(computeKpiScore({ notifications: 100, csat: 100, service: 100 }), 100);
  // 0 / 100 / 100 → 70 (matches Март Արփինե in the sheet).
  assert.equal(computeKpiScore({ notifications: 0, csat: 100, service: 100 }), 70);
  // 92.73 / 100 / (empty=0) → 67.819 (matches Май Հասմիկ).
  assert.equal(computeKpiScore({ notifications: 92.73, csat: 100 }), 67.819);
  // Missing values count as 0.
  assert.equal(computeKpiScore({}), 0);
});

test("KPI bonus gate: service≥90, notifications=100, csat≥80", () => {
  assert.equal(kpiBonusEligible({ service: 90, notifications: 100, csat: 80 }), true);
  assert.equal(kpiBonusEligible({ service: 89, notifications: 100, csat: 80 }), false);
  assert.equal(kpiBonusEligible({ service: 95, notifications: 90, csat: 100 }), false);
  assert.equal(kpiBonusEligible({ service: 100, notifications: 100, csat: 79 }), false);
});

test("mondayOf snaps any day to its ISO week Monday", () => {
  assert.equal(mondayOf("2026-06-15"), "2026-06-15"); // Monday
  assert.equal(mondayOf("2026-06-16"), "2026-06-15"); // Tuesday → Monday
  assert.equal(mondayOf("2026-06-21"), "2026-06-15"); // Sunday → that Monday
  assert.equal(mondayOf("2026-06-22"), "2026-06-22"); // next Monday
});

test("isNonWorkingDay flags weekends and RA holidays", () => {
  assert.equal(isNonWorkingDay("2026-06-22"), false); // Monday
  assert.equal(isNonWorkingDay("2026-06-19"), false); // Friday
  assert.equal(isNonWorkingDay("2026-06-20"), true); // Saturday
  assert.equal(isNonWorkingDay("2026-06-21"), true); // Sunday
  assert.equal(isNonWorkingDay("2026-05-01"), true); // Labour Day (weekday)
  assert.equal(isNonWorkingDay("2026-01-06"), true); // Armenian Christmas
});

test("reviewDayOf rolls weekend/holiday activity to the next working day", () => {
  // A working day is reviewed on itself.
  assert.equal(reviewDayOf("2026-06-22"), "2026-06-22"); // Monday → Monday
  assert.equal(reviewDayOf("2026-06-19"), "2026-06-19"); // Friday → Friday
  // Weekend rolls onto the following Monday.
  assert.equal(reviewDayOf("2026-06-20"), "2026-06-22"); // Saturday → Monday
  assert.equal(reviewDayOf("2026-06-21"), "2026-06-22"); // Sunday → Monday
  // A holiday rolls forward; consecutive non-working days chain through.
  assert.equal(reviewDayOf("2026-05-01"), "2026-05-04"); // Fri holiday → Monday
  // Christmas (Tue 2026-01-06) is a weekday holiday → next working day.
  assert.equal(reviewDayOf("2026-01-06"), "2026-01-07");
});

test("reviewDayForActivity rolls Friday-after-19:00 activity to Monday", () => {
  // Yerevan is UTC+4 (no DST). 2026-06-19 is a Friday.
  // Before close (18:00 Yerevan = 14:00Z) → reviewed on Friday.
  assert.equal(
    reviewDayForActivity("2026-06-19T14:00:00Z", "2026-06-19"),
    "2026-06-19"
  );
  // After close (19:30 Yerevan = 15:30Z) → rolls to Monday.
  assert.equal(
    reviewDayForActivity("2026-06-19T15:30:00Z", "2026-06-19"),
    "2026-06-22"
  );
  // Late Friday (23:00 Yerevan = 19:00Z) → Monday.
  assert.equal(
    reviewDayForActivity("2026-06-19T19:00:00Z", "2026-06-19"),
    "2026-06-22"
  );
  // A non-Friday weekday evening is unaffected (Tuesday stays Tuesday).
  assert.equal(
    reviewDayForActivity("2026-06-16T16:00:00Z", "2026-06-16"),
    "2026-06-16"
  );
  // No timestamp → behaves exactly like reviewDayOf on the fallback date.
  assert.equal(reviewDayForActivity(null, "2026-06-20"), "2026-06-22"); // Sat → Mon
  assert.equal(reviewDayForActivity(undefined, "2026-06-16"), "2026-06-16"); // Tue
});

test("isoWeekLabel gives the ISO-8601 week", () => {
  assert.equal(isoWeekLabel("2026-06-15"), "2026-W25");
  // The Thursday rule: 2026-01-01 (Thu) is in week 1.
  assert.equal(isoWeekLabel("2026-01-01"), "2026-W01");
});

test("isTaskClosed: normal task closes on completion; recurring needs QA", () => {
  // A normal completed task is closed.
  assert.equal(isTaskClosed({ task_status: "Completed (On Time)" }), true);
  // Not completed → open.
  assert.equal(isTaskClosed({ task_status: "Overdue" }), false);
  // Recurring + completed but NOT QA-confirmed → still open (boss's rule).
  assert.equal(
    isTaskClosed({ task_status: "Completed (Late)", recurring: true, qa_confirmed: false }),
    false
  );
  // Recurring + completed + QA-confirmed → closed.
  assert.equal(
    isTaskClosed({ task_status: "Completed (Late)", recurring: true, qa_confirmed: true }),
    true
  );
});

test("isTaskDue: open task at/past its (postponed) due date", () => {
  // Due yesterday, still open → due.
  assert.equal(
    isTaskDue({ task_status: "-", due_date_original: "2026-06-18" }, "2026-06-19"),
    true
  );
  // Due in the future → not yet.
  assert.equal(
    isTaskDue({ task_status: "-", due_date_original: "2026-06-25" }, "2026-06-19"),
    false
  );
  // Postponed date wins over the original.
  assert.equal(
    isTaskDue(
      { task_status: "-", due_date_original: "2026-06-10", due_date_postponed: "2026-06-25" },
      "2026-06-19"
    ),
    false
  );
  // A closed task is never "due".
  assert.equal(
    isTaskDue({ task_status: "Completed (On Time)", due_date_original: "2026-06-01" }, "2026-06-19"),
    false
  );
});

// --- mailingPeriodOf: the рассылки cycle rolls over on the 28th --------------
import { mailingPeriodOf, prevMailingPeriod } from "../src/lib/scoring";

test("mailingPeriodOf: dates before the 28th belong to the current month's cycle", () => {
  assert.equal(mailingPeriodOf("2026-06-01"), "202606");
  assert.equal(mailingPeriodOf("2026-06-15"), "202606");
  assert.equal(mailingPeriodOf("2026-06-27"), "202606");
});

test("mailingPeriodOf: the 28th and later roll into the NEXT month's cycle", () => {
  assert.equal(mailingPeriodOf("2026-06-28"), "202607");
  assert.equal(mailingPeriodOf("2026-06-30"), "202607");
  // December rolls into January of the next year.
  assert.equal(mailingPeriodOf("2026-12-28"), "202701");
  assert.equal(mailingPeriodOf("2026-12-31"), "202701");
});

test("prevMailingPeriod steps back one cycle, across year boundaries", () => {
  assert.equal(prevMailingPeriod("202607"), "202606");
  assert.equal(prevMailingPeriod("202701"), "202612");
});
