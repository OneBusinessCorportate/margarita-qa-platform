import { test } from "node:test";
import assert from "node:assert/strict";
import { computeViolationFines, groupNarusheniya } from "../src/lib/violations.js";

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

// --- «за каждый чат»: несколько проблем в одном чате = ОДНО нарушение ---------

test("2 проблемы в ОДНОМ чате за неделю = одно нарушение (предупреждение, не 2×1 000)", () => {
  const rows = [v({ chat_agr_no: "B-1" }), v({ chat_agr_no: "B-1", vdate: "2026-07-08" })];
  // Один чат за неделю → предупреждение; штраф не начисляется дважды.
  assert.deepEqual(computeViolationFines(rows), [0, 0]);
  assert.equal(groupNarusheniya(rows).length, 1);
});

test("2 РАЗНЫХ чата за неделю → 2 нарушения → 1 000 др за каждый", () => {
  const fines = computeViolationFines([
    v({ chat_agr_no: "B-1" }),
    v({ chat_agr_no: "B-2" }),
  ]);
  assert.deepEqual(fines, [1000, 1000]);
});

test("один чат со средним И критичным = одно нарушение, худшая тяжесть → 2 000 один раз", () => {
  const fines = computeViolationFines([
    v({ chat_agr_no: "B-1" }),
    v({ chat_agr_no: "B-1", severity: "Критичное", vdate: "2026-07-07" }),
  ]);
  // Не 1 000 + 2 000: чат — одно нарушение, критичное → 2 000, начислено один раз.
  assert.deepEqual(fines, [2000, 0]);
  const [n] = groupNarusheniya([
    v({ chat_agr_no: "B-1" }),
    v({ chat_agr_no: "B-1", severity: "Критичное", vdate: "2026-07-07" }),
  ]);
  assert.equal(n.severity, "Критичное");
  assert.equal(n.fine, 2000);
});

test("groupNarusheniya собирает описания проблем чата в один список", () => {
  const [n] = groupNarusheniya([
    v({ chat_agr_no: "B-1", violation_type: "Долгий ответ" }),
    v({ chat_agr_no: "B-1", vdate: "2026-07-07", violation_type: "Игнорирование задач" }),
  ]);
  assert.deepEqual(n.types, ["Долгий ответ", "Игнорирование задач"]);
});
