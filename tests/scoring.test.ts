import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BANDS,
  CRITERIA,
  TASK_CATEGORIES,
  bandFor,
  computeTaskStatusTotal,
  computeWeightedTotal,
} from "../src/lib/scoring";

test("criteria weights sum to 100", () => {
  const sum = CRITERIA.reduce((s, c) => s + c.weight, 0);
  assert.equal(sum, 100);
});

test("perfect scores give 100", () => {
  const total = computeWeightedTotal({
    accuracy: 5,
    sla: 5,
    fcr: 5,
    clarity: 5,
  });
  assert.equal(total, 100);
});

test("zero scores give 0", () => {
  const total = computeWeightedTotal({ accuracy: 0, sla: 0, fcr: 0, clarity: 0 });
  assert.equal(total, 0);
});

test("weighted total matches Σ(score × weight ÷ 5)", () => {
  // accuracy 4 (40), sla 3 (25), fcr 2 (20), clarity 5 (15)
  // = 4*40/5 + 3*25/5 + 2*20/5 + 5*15/5 = 32 + 15 + 8 + 15 = 70
  const total = computeWeightedTotal({ accuracy: 4, sla: 3, fcr: 2, clarity: 5 });
  assert.equal(total, 70);
});

test("missing criteria are skipped (not treated as 0)", () => {
  // only accuracy=5 -> 5*40/5 = 40
  const total = computeWeightedTotal({ accuracy: 5 });
  assert.equal(total, 40);
});

test("out-of-range scores are clamped", () => {
  const total = computeWeightedTotal({ accuracy: 99, sla: -5, fcr: 5, clarity: 5 });
  // accuracy clamps to 5 (40), sla clamps to 0, fcr 20, clarity 15 = 75
  assert.equal(total, 75);
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
    const band = bandFor(n);
    const def = BANDS.find((b) => b.band === band)!;
    assert.ok(n >= def.min && n <= def.max, `score ${n} -> ${band}`);
  }
});

test("task-status model: full credit gives 100", () => {
  const total = computeTaskStatusTotal({
    main_taxes: "Отправил",
    salary: "Получил",
    primary_docs: "1ый/2ой написал",
    debts: "нет долга",
  });
  assert.equal(total, 100);
});

test("task-status model: penalizing statuses reduce total", () => {
  const total = computeTaskStatusTotal({
    main_taxes: "Не запросил 1", // 0 credit, weight 30
    salary: "Получил",
    primary_docs: "1ый/2ой написал",
    debts: "нет долга",
  });
  assert.equal(total, 70);
});

test("task categories weights sum to 100", () => {
  const sum = TASK_CATEGORIES.reduce((s, c) => s + c.weight, 0);
  assert.equal(sum, 100);
});
