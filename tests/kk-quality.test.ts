import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KK_CRITERIA,
  computeKkScore,
  kkLevel,
} from "../src/lib/scoring";

// Numbers below are taken straight from Margarita's "Общая оценка" journal
// (the КК / Контроль качества file), so the platform matches her sheet exactly.

test("KK criteria weights are her Гайд Wi values and sum to 100", () => {
  assert.deepEqual(
    KK_CRITERIA.map((c) => c.weight),
    [10, 30, 20, 30, 10]
  );
  assert.equal(KK_CRITERIA.reduce((s, c) => s + c.weight, 0), 100);
});

test("computeKkScore reproduces her journal totals", () => {
  // Թագուհի: 20/80/90/100/100 -> 84
  assert.equal(
    computeKkScore({ errors: 20, deadlines: 80, reporting: 90, documents: 100, rework: 100 }),
    84
  );
  // Լիլիթ: 10/80/100/100/100 -> 85
  assert.equal(
    computeKkScore({ errors: 10, deadlines: 80, reporting: 100, documents: 100, rework: 100 }),
    85
  );
  // Հասմիկ: 100/80/100/100/100 -> 94
  assert.equal(
    computeKkScore({ errors: 100, deadlines: 80, reporting: 100, documents: 100, rework: 100 }),
    94
  );
});

test("an empty assessment is 0 (not a partial score)", () => {
  assert.equal(computeKkScore({}), 0);
});

test("missing criteria count as 0, matching the sheet", () => {
  // Only deadlines (weight 30) filled at 100 -> 30.
  assert.equal(computeKkScore({ deadlines: 100 }), 30);
});

test("kkLevel maps the total to her action scale", () => {
  assert.match(kkLevel(94).action, /Премирование/); // 4.50-5.00
  assert.match(kkLevel(90).action, /Премирование/); // boundary
  assert.match(kkLevel(84).action, /План развития/); // 3.50-4.49
  assert.match(kkLevel(60).action, /корректирующих/); // 2.50-3.49
  assert.match(kkLevel(30).action, /Административные/); // 1.00-2.49
});
