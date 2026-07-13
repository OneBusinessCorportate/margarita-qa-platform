import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport } from "../src/lib/report";
import { seedChats, seedEvaluations, seedTasks } from "../src/lib/seed-data";

test("report totals reflect seed data with no filters", () => {
  // As of 2026-06-15: genuinely active = status Active AND recent activity.
  // Stale in seed: #19 (06-10), #102 (06-11), #510 (05-28), #700 (never) → 4.
  const r = buildReport(seedChats, seedEvaluations, {}, seedTasks, "2026-06-15");
  assert.equal(r.totals.activeChats, 10);
  // one active chat without an accountant (700)
  assert.equal(r.totals.chatsWithoutResponsible, 1);
  // 8 evaluations across 8 distinct chats
  assert.equal(r.totals.evaluatedChats, 8);
});

test("activeChats excludes chats that went quiet (stale activity)", () => {
  // Same day, but a chat last active on Wednesday 06-10 is NOT counted active.
  const asOf = "2026-06-15";
  const live = buildReport(seedChats, seedEvaluations, {}, seedTasks, asOf)
    .totals.activeChats;
  // Pretend everything was active today → all 14 status-Active chats count.
  const allFresh = seedChats.map((c) => ({ ...c, last_activity_date: asOf }));
  const fresh = buildReport(allFresh, seedEvaluations, {}, seedTasks, asOf)
    .totals.activeChats;
  assert.equal(fresh, 14);
  assert.equal(live, 10);
  assert.ok(live < fresh, "stale chats must drop out of the active count");
});

test("distribution counts add up to number of evaluations", () => {
  const r = buildReport(seedChats, seedEvaluations, {}, seedTasks);
  const sum =
    r.distribution.Отлично + r.distribution.Хорошо + r.distribution.Плохо + r.distribution.Критично;
  assert.equal(sum, seedEvaluations.length);
});

test("accountant filter narrows results", () => {
  const r = buildReport(seedChats, seedEvaluations, { accountant: "Լիլիթ" }, seedTasks);
  // Лилит evaluated chats 23 and 100
  assert.equal(r.totals.evaluatedChats, 2);
  assert.equal(r.perAccountant.length, 1);
  assert.equal(r.perAccountant[0].accountant, "Լիլիթ");
});

test("date range filter excludes out-of-range evaluations", () => {
  const r = buildReport(seedChats, seedEvaluations, { from: "2026-06-11", to: "2026-06-11" }, seedTasks);
  // e7 is dated 2026-06-10 -> excluded, leaving 7
  const sum =
    r.distribution.Отлично + r.distribution.Хорошо + r.distribution.Плохо + r.distribution.Критично;
  assert.equal(sum, 7);
});

test("service quality is the average of totals", () => {
  const r = buildReport(seedChats, seedEvaluations, {}, seedTasks);
  const avg = seedEvaluations.reduce((s, e) => s + e.total_score, 0) / seedEvaluations.length;
  assert.equal(r.serviceQualityPct, Math.round(avg * 10) / 10);
});

test("client filter matches by agr_no", () => {
  const r = buildReport(seedChats, seedEvaluations, { client: "100" }, seedTasks);
  assert.equal(r.totals.evaluatedChats, 1);
});

test("manual score override (п.8) is applied and surfaced in the report", () => {
  const override = {
    id: "o1",
    chat_agr_no: "23",
    client_name: null,
    score_date: "2026-06-11",
    old_score: 100,
    new_score: 40,
    changed_by: "info@onebusiness.am",
    comment: "Пересмотрела за прошлый день",
    created_at: "2026-06-12T09:00:00.000Z",
  };
  const r = buildReport(
    seedChats,
    seedEvaluations,
    { from: "2026-06-11", to: "2026-06-11" },
    seedTasks,
    "2026-06-15",
    [override]
  );
  // Listed for the report/PDF, exactly once, with the edit details.
  assert.equal(r.manualOverrides?.length, 1);
  assert.equal(r.manualOverrides![0].chat_agr_no, "23");
  assert.equal(r.manualOverrides![0].new_score, 40);
  assert.equal(r.manualOverrides![0].old_score, 100);
  // п.8: «кто и когда» — the edit timestamp is carried through to the report/PDF.
  assert.equal(r.manualOverrides![0].edited_at, "2026-06-12T09:00:00.000Z");
  assert.equal(r.manualOverridesCount, 1);
  // Chat 23 (was Отлично) now scores 40 → Критично, so it shows up as critical.
  assert.ok(r.criticalChats.some((c) => c.chat_agr_no === "23"));
});

test("manual override outside the date window is not surfaced", () => {
  const override = {
    id: "o2",
    chat_agr_no: "23",
    client_name: null,
    score_date: "2026-06-10", // one day before the window
    old_score: 100,
    new_score: 40,
    changed_by: "info@onebusiness.am",
    comment: "не в окне",
    created_at: "2026-06-12T09:00:00.000Z",
  };
  const r = buildReport(
    seedChats,
    seedEvaluations,
    { from: "2026-06-11", to: "2026-06-11" },
    seedTasks,
    "2026-06-15",
    [override]
  );
  assert.equal(r.manualOverrides?.length ?? 0, 0);
});

test("per-accountant breakdown flags low scores", () => {
  const r = buildReport(seedChats, seedEvaluations, {}, seedTasks);
  const avag = r.perAccountant.find((a) => a.accountant === "Ավագ");
  assert.ok(avag);
  assert.equal(avag!.lowCount, 1); // e5 is Критично
});

test("tasks block aggregates by status", () => {
  const r = buildReport(seedChats, seedEvaluations, {}, seedTasks);
  assert.equal(r.tasks.total, seedTasks.length);
  assert.equal(r.tasks.onTime, 1); // t2
  assert.equal(r.tasks.late, 2); // t1, t3
  assert.equal(r.tasks.overdue, 1); // t4
});

test("coverage = evaluated chats ÷ active chats", () => {
  const r = buildReport(seedChats, seedEvaluations, {}, seedTasks, "2026-06-15");
  // 8 evaluated of 10 active = 80%.
  assert.equal(r.totals.activeChats, 10);
  assert.equal(r.totals.evaluatedChats, 8);
  assert.equal(r.coveragePct, 80);
});

test("criticalChats lists gated chats worst-first with reasons", () => {
  const r = buildReport(seedChats, seedEvaluations, {}, seedTasks);
  // e5 (chat 180, salary not requested) and e8 (chat 28, taxes not sent) are gated to 1.
  const ids = r.criticalChats.map((c) => c.chat_agr_no).sort();
  assert.deepEqual(ids, ["180", "28"]);
  for (const c of r.criticalChats) {
    assert.equal(c.score, 1);
    assert.ok(c.reasons.length > 0, "a gated chat must carry a failing-mailing reason");
  }
});

test("unansweredChats surfaces active chats where the client had the last word", () => {
  const r = buildReport(seedChats, seedEvaluations, {}, seedTasks, "2026-06-15");
  const ids = r.unansweredChats.map((c) => c.chat_agr_no).sort();
  assert.deepEqual(ids, ["100", "11"]);
  assert.equal(r.totals.unansweredChats, 2);
  // Longest wait first: chat 100 (06-12) waited longer than chat 11 (06-13).
  assert.equal(r.unansweredChats[0].chat_agr_no, "100");
  assert.equal(r.unansweredChats[0].waitingDays, 3);
});
