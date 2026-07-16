import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIDENCE_RANGES,
  INSUFFICIENT_DATA_MESSAGE,
  interpretCorrelation,
  pearson,
  periodRange,
  rangeOf,
  reviewStatusFor,
  validConfidence,
  yerevanDate,
} from "../src/lib/confidence";
import type { AiSnapshot } from "../src/lib/ai";

test("rangeOf maps confidence into the six required buckets", () => {
  assert.equal(rangeOf(0)?.id, "0-49");
  assert.equal(rangeOf(49)?.id, "0-49");
  assert.equal(rangeOf(50)?.id, "50-69");
  assert.equal(rangeOf(69)?.id, "50-69");
  assert.equal(rangeOf(70)?.id, "70-79");
  assert.equal(rangeOf(80)?.id, "80-89");
  assert.equal(rangeOf(90)?.id, "90-94");
  assert.equal(rangeOf(94)?.id, "90-94");
  assert.equal(rangeOf(95)?.id, "95-100");
  assert.equal(rangeOf(100)?.id, "95-100");
});

test("ranges cover 0..100 with no gaps or overlaps", () => {
  for (let c = 0; c <= 100; c++) {
    const hits = CONFIDENCE_RANGES.filter((r) => c >= r.min && c <= r.max);
    assert.equal(hits.length, 1, `confidence ${c} must belong to exactly one range`);
  }
});

test("rangeOf returns null for missing confidence (Нет данных, not 0%)", () => {
  assert.equal(rangeOf(null), null);
  assert.equal(rangeOf(undefined), null);
  assert.equal(rangeOf(NaN), null);
});

test("validConfidence rejects out-of-range and non-numbers", () => {
  assert.equal(validConfidence(0), 0);
  assert.equal(validConfidence(100), 100);
  assert.equal(validConfidence(-1), null);
  assert.equal(validConfidence(101), null);
  assert.equal(validConfidence("80"), null);
  assert.equal(validConfidence(null), null);
});

const ai = (total: number): AiSnapshot => ({
  criteria: { accuracy: 4, sla: 5 },
  monthly: { main_taxes: { status: "Отправил" } },
  total,
  confidence: 90,
});

test("reviewStatusFor: identical final = accepted", () => {
  const status = reviewStatusFor(
    ai(88),
    { criteria: { accuracy: 4, sla: 5 }, monthly: { main_taxes: { status: "Отправил", prev: "--" } } },
    88
  );
  assert.equal(status, "accepted");
});

test("reviewStatusFor: different total or criteria = corrected", () => {
  const diffTotal = reviewStatusFor(
    ai(88),
    { criteria: { accuracy: 4, sla: 5 }, monthly: { main_taxes: { status: "Отправил", prev: "--" } } },
    70
  );
  assert.equal(diffTotal, "corrected");
  const diffCrit = reviewStatusFor(
    ai(88),
    { criteria: { accuracy: 3, sla: 5 }, monthly: { main_taxes: { status: "Отправил", prev: "--" } } },
    88
  );
  assert.equal(diffCrit, "corrected");
});

test("reviewStatusFor: no AI baseline = null (leave not_reviewed)", () => {
  assert.equal(reviewStatusFor(null, { criteria: {} }, 90), null);
  assert.equal(reviewStatusFor(undefined, { criteria: {} }, 90), null);
});

test("pearson is -1 for perfectly anti-correlated data", () => {
  const r = pearson([
    [95, 0],
    [90, 0],
    [40, 1],
    [30, 1],
  ]);
  assert.ok(r !== null && r < -0.99);
});

test("pearson is null when a variable has no variance", () => {
  // all accepted → y is constant
  assert.equal(pearson([[95, 0], [40, 0], [80, 0]]), null);
  assert.equal(pearson([[80, 1]]), null); // fewer than 2 pairs
});

test("interpretCorrelation flags insufficient data below 30", () => {
  const few = interpretCorrelation(-0.5, 10);
  assert.equal(few.insufficient, true);
  const enough = interpretCorrelation(-0.5, 40);
  assert.equal(enough.insufficient, false);
});

test("interpretCorrelation wording matches sign", () => {
  assert.match(interpretCorrelation(-0.5, 40).text, /реже/);
  assert.match(interpretCorrelation(0.5, 40).text, /чаще/);
  assert.match(interpretCorrelation(0.0, 40).text, /близка к нулю/);
});

test("INSUFFICIENT_DATA_MESSAGE matches the required Russian string", () => {
  assert.equal(
    INSUFFICIENT_DATA_MESSAGE,
    "Недостаточно данных для надёжного вывода. Необходимо минимум 30 проверенных оценок."
  );
});

test("periodRange computes Yerevan today/yesterday/week/month", () => {
  // 2026-07-16 00:30 UTC → still 04:30 Yerevan same day (UTC+4).
  const now = "2026-07-16T00:30:00.000Z";
  assert.equal(yerevanDate(now), "2026-07-16");
  assert.deepEqual(periodRange("today", now), { from: "2026-07-16", to: "2026-07-16" });
  assert.deepEqual(periodRange("yesterday", now), { from: "2026-07-15", to: "2026-07-15" });
  // 2026-07-16 is a Thursday → week starts Monday 2026-07-13.
  assert.deepEqual(periodRange("week", now), { from: "2026-07-13", to: "2026-07-16" });
  assert.deepEqual(periodRange("month", now), { from: "2026-07-01", to: "2026-07-16" });
});

test("periodRange respects Yerevan offset near midnight UTC", () => {
  // 2026-07-15 21:00 UTC = 2026-07-16 01:00 Yerevan → today is the 16th.
  const now = "2026-07-15T21:00:00.000Z";
  assert.equal(yerevanDate(now), "2026-07-16");
});
