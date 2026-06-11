import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport } from "../src/lib/report";
import { seedChats, seedEvaluations } from "../src/lib/seed-data";

test("report totals reflect seed data with no filters", () => {
  const r = buildReport(seedChats, seedEvaluations, {});
  // 9 active chats in seed (one Inactive: 318)
  assert.equal(r.totals.activeChats, 9);
  // one active chat without accountant (523)
  assert.equal(r.totals.chatsWithoutResponsible, 1);
  // evaluated distinct chats = 7 evaluations across 7 distinct chats
  assert.equal(r.totals.evaluatedChats, 7);
});

test("distribution counts add up to number of evaluations", () => {
  const r = buildReport(seedChats, seedEvaluations, {});
  const sum =
    r.distribution.Отлично +
    r.distribution.Хорошо +
    r.distribution.Плохо +
    r.distribution.Критично;
  assert.equal(sum, seedEvaluations.length);
});

test("accountant filter narrows results", () => {
  const r = buildReport(seedChats, seedEvaluations, { accountant: "Լիլիթ" });
  // Лилит evaluated 2 chats (B-3302, 401)
  assert.equal(r.totals.evaluatedChats, 2);
  assert.equal(r.perAccountant.length, 1);
  assert.equal(r.perAccountant[0].accountant, "Լիլիթ");
});

test("date range filter excludes out-of-range evaluations", () => {
  const r = buildReport(seedChats, seedEvaluations, {
    from: "2026-06-11",
    to: "2026-06-11",
  });
  // e7 is dated 2026-06-10 -> excluded, leaving 6 evaluations
  const sum =
    r.distribution.Отлично +
    r.distribution.Хорошо +
    r.distribution.Плохо +
    r.distribution.Критично;
  assert.equal(sum, 6);
});

test("service quality is the average of totals", () => {
  const r = buildReport(seedChats, seedEvaluations, {});
  const avg =
    seedEvaluations.reduce((s, e) => s + e.total_score, 0) /
    seedEvaluations.length;
  assert.equal(r.serviceQualityPct, Math.round(avg * 10) / 10);
});

test("client filter matches by agr_no", () => {
  const r = buildReport(seedChats, seedEvaluations, { client: "B-3302" });
  assert.equal(r.totals.evaluatedChats, 1);
});

test("per-accountant breakdown flags low scores", () => {
  const r = buildReport(seedChats, seedEvaluations, {});
  const tigran = r.perAccountant.find((a) => a.accountant === "Տիգրան");
  // Tigran's only eval is Критично -> lowCount 1
  assert.ok(tigran);
  assert.equal(tigran!.lowCount, 1);
});
