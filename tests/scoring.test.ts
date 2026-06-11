import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BANDS,
  CRITERIA,
  DAILY_CRITERIA,
  DEBT_STATUSES,
  MONTHLY_CATEGORIES,
  bandFor,
  computeOverall,
  computeWeightedTotal,
} from "../src/lib/scoring";

test("criteria weights sum to 100", () => {
  assert.equal(CRITERIA.reduce((s, c) => s + c.weight, 0), 100);
});

test("daily criteria are accuracy + sla", () => {
  assert.deepEqual(DAILY_CRITERIA.map((c) => c.id), ["accuracy", "sla"]);
});

test("computeWeightedTotal: perfect = 100, zero = 0", () => {
  assert.equal(computeWeightedTotal({ accuracy: 5, sla: 5, fcr: 5, clarity: 5 }), 100);
  assert.equal(computeWeightedTotal({ accuracy: 0, sla: 0, fcr: 0, clarity: 0 }), 0);
});

test("computeWeightedTotal matches Σ(score × weight ÷ 5)", () => {
  // 4*40/5 + 3*25/5 + 2*20/5 + 5*15/5 = 32+15+8+15 = 70
  assert.equal(computeWeightedTotal({ accuracy: 4, sla: 3, fcr: 2, clarity: 5 }), 70);
});

test("computeWeightedTotal skips missing criteria (treats as 0 contribution)", () => {
  assert.equal(computeWeightedTotal({ accuracy: 5 }), 40);
});

test("computeOverall treats un-entered criteria as FULL marks", () => {
  // accuracy 5 + sla 5 + fcr(full 20) + clarity(full 15) = 100
  assert.equal(computeOverall({ accuracy: 5, sla: 5 }), 100);
  // accuracy 4 -> 32 + 25 + 20 + 15 = 92
  assert.equal(computeOverall({ accuracy: 4, sla: 5 }), 92);
  // nothing entered -> all full -> 100
  assert.equal(computeOverall({}), 100);
  // both zero -> 0 + 0 + 20 + 15 = 35
  assert.equal(computeOverall({ accuracy: 0, sla: 0 }), 35);
});

test("bandFor maps boundaries correctly", () => {
  assert.equal(bandFor(100), "Отлично");
  assert.equal(bandFor(90), "Отлично");
  assert.equal(bandFor(89), "Хорошо");
  assert.equal(bandFor(80), "Хорошо");
  assert.equal(bandFor(79), "Плохо");
  assert.equal(bandFor(60), "Плохо");
  assert.equal(bandFor(59), "Критично");
  assert.equal(bandFor(1), "Критично");
  assert.equal(bandFor(0), "Критично");
});

test("bands cover 1..100 with no gaps", () => {
  for (let n = 1; n <= 100; n++) {
    const def = BANDS.find((b) => b.band === bandFor(n))!;
    assert.ok(n >= def.min && n <= def.max, `score ${n}`);
  }
});

test("there are 4 monthly task categories with correct due days", () => {
  assert.equal(MONTHLY_CATEGORIES.length, 4);
  const byId = Object.fromEntries(MONTHLY_CATEGORIES.map((c) => [c.id, c.dueDay]));
  assert.equal(byId.main_taxes, 15);
  assert.equal(byId.salary, 10);
  assert.equal(byId.primary_docs, 28);
  assert.equal(byId.debts, 5);
});

test("debts category uses the 'нет долга' status set", () => {
  const debts = MONTHLY_CATEGORIES.find((c) => c.id === "debts")!;
  assert.equal(debts.statuses, DEBT_STATUSES);
  assert.ok(DEBT_STATUSES.includes("нет долга"));
});
