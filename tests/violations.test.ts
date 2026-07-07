import { test } from "node:test";
import assert from "node:assert/strict";
import { computeIndividualFines, computeViolationFines } from "../src/lib/violations.js";

const v = (over: Partial<Parameters<typeof computeViolationFines>[0][0]> = {}) => ({
  vdate: "2026-07-06",
  accountant: "Ա",
  severity: "Среднее",
  sanction: null,
  ...over,
});

test("single medium violation in a week → warning, 0 др", () => {
  assert.deepEqual(computeViolationFines([v()]), [0]);
});

test("2+ mediums per accountant per week → 1 000 др each", () => {
  const fines = computeViolationFines([v(), v({ vdate: "2026-07-07" })]);
  assert.deepEqual(fines, [1000, 1000]);
});

test("mediums in DIFFERENT weeks don't sum toward the 2-per-week rule", () => {
  const fines = computeViolationFines([v(), v({ vdate: "2026-07-13" })]);
  assert.deepEqual(fines, [0, 0]);
});

test("mediums of DIFFERENT accountants don't sum", () => {
  const fines = computeViolationFines([v(), v({ accountant: "Բ" })]);
  assert.deepEqual(fines, [0, 0]);
});

test("critical violation → 2 000 др each, no weekly threshold", () => {
  assert.deepEqual(computeViolationFines([v({ severity: "Критичное" })]), [2000]);
});

test("gross escalation per year: 1st warning, 2nd 10 000, 3rd+ 30 000", () => {
  const fines = computeViolationFines([
    v({ severity: "Грубое", vdate: "2026-03-01" }),
    v({ severity: "Грубое", vdate: "2026-05-01" }),
    v({ severity: "Грубое", vdate: "2026-07-01" }),
    v({ severity: "Грубое", vdate: "2026-08-01" }),
  ]);
  assert.deepEqual(fines, [0, 10000, 30000, 30000]);
});

test("grossPrior carries this-year history into the escalation", () => {
  const fines = computeViolationFines(
    [v({ severity: "Грубое" })],
    { grossPrior: { Ա: 1 } }
  );
  assert.deepEqual(fines, [10000]); // it's the 2nd gross this year
});

test("manual sanction always overrides the computed amount", () => {
  const fines = computeViolationFines([
    v({ sanction: 5000 }), // manual wins over the 0 the rule would give
    v({ severity: "Критичное", sanction: 500 }), // manual wins over 2000
  ]);
  assert.deepEqual(fines, [5000, 500]);
});

// --- computeIndividualFines — each case priced on its own (daily report) ----

test("individual pricing: every medium costs 1 000 even when it's the only one", () => {
  assert.deepEqual(computeIndividualFines([v()]), [1000]);
});

test("individual pricing: severities map to their own amounts per case", () => {
  const fines = computeIndividualFines([
    v(), // Среднее → 1 000
    v({ severity: "Критичное" }), // → 2 000
    v({ severity: "Среднее", accountant: "Բ" }), // → 1 000, own case
  ]);
  assert.deepEqual(fines, [1000, 2000, 1000]);
});

test("individual pricing: gross keeps the per-year escalation", () => {
  const fines = computeIndividualFines(
    [
      v({ severity: "Грубое", vdate: "2026-03-01" }),
      v({ severity: "Грубое", vdate: "2026-05-01" }),
    ],
    { grossPrior: { Ա: 1 } }
  );
  assert.deepEqual(fines, [10000, 30000]); // 2nd and 3rd gross this year
});

test("individual pricing: manual sanction still wins", () => {
  assert.deepEqual(computeIndividualFines([v({ sanction: 500 })]), [500]);
});
