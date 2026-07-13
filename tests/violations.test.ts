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

test("single medium violation in a day → warning, 0 др", () => {
  assert.deepEqual(computeViolationFines([v()]), [0]);
});

test("2nd medium the SAME day → 1-е предупреждение (0), 2-е 1 000 др", () => {
  // Both on 2026-07-06, different chats (no code → each its own нарушение).
  const fines = computeViolationFines([v(), v()]);
  assert.deepEqual(fines, [0, 1000]);
});

test("3 mediums the same day → 0, 1 000, 1 000 (только 1-е — предупреждение)", () => {
  assert.deepEqual(computeViolationFines([v(), v(), v()]), [0, 1000, 1000]);
});

test("mediums on DIFFERENT days don't escalate — каждое 1-е за свой день", () => {
  const fines = computeViolationFines([v(), v({ vdate: "2026-07-07" })]);
  assert.deepEqual(fines, [0, 0]);
});

test("mediums of DIFFERENT accountants don't sum", () => {
  const fines = computeViolationFines([v(), v({ accountant: "Բ" })]);
  assert.deepEqual(fines, [0, 0]);
});

test("тяжесть НЕ выставляет авто-сумму: 1 критичное за день = предупреждение (0), НЕ 2 000", () => {
  // Правило Маргариты: 1-е за день — предупреждение, даже если критичное.
  assert.deepEqual(computeViolationFines([v({ severity: "Критичное" })]), [0]);
});

test("грубое подчиняется тому же дневному правилу (нет спец-эскалации 10 000/30 000)", () => {
  // Разные дни → каждое 1-е за свой день → предупреждение.
  const fines = computeViolationFines([
    v({ severity: "Грубое", vdate: "2026-03-01" }),
    v({ severity: "Грубое", vdate: "2026-05-01" }),
    v({ severity: "Грубое", vdate: "2026-07-01" }),
  ]);
  assert.deepEqual(fines, [0, 0, 0]);
  // 2 критичных за ОДИН день → 1-е предупреждение (0), 2-е штраф 1 000.
  assert.deepEqual(
    computeViolationFines([v({ severity: "Критичное" }), v({ severity: "Критичное" })]),
    [0, 1000]
  );
});

test("ручная санкция — подтверждённый штраф Маргариты, перебивает эскалацию", () => {
  assert.deepEqual(computeViolationFines([v({ severity: "Критичное", sanction: 2000 })]), [2000]);
});

test("manual sanction always overrides the computed amount", () => {
  const fines = computeViolationFines([
    v({ sanction: 5000 }), // manual wins over the 0 the rule would give
    v({ severity: "Критичное", sanction: 500 }), // manual wins over 2000
  ]);
  assert.deepEqual(fines, [5000, 500]);
});

// --- «за каждый чат»: несколько проблем в одном чате за ОДИН день = ОДНО нарушение

test("2 проблемы в ОДНОМ чате за один день = одно нарушение (предупреждение, не 2×1 000)", () => {
  const rows = [v({ chat_agr_no: "B-1" }), v({ chat_agr_no: "B-1" })];
  // Один чат за день → одно нарушение → 1-е за день → предупреждение.
  assert.deepEqual(computeViolationFines(rows), [0, 0]);
  assert.equal(groupNarusheniya(rows).length, 1);
});

test("один и тот же чат в РАЗНЫЕ дни = два нарушения (каждое 1-е за свой день)", () => {
  const rows = [
    v({ chat_agr_no: "B-1" }),
    v({ chat_agr_no: "B-1", vdate: "2026-07-08" }),
  ];
  assert.equal(groupNarusheniya(rows).length, 2);
  assert.deepEqual(computeViolationFines(rows), [0, 0]);
});

test("2 РАЗНЫХ чата за один день → 1-е предупреждение, 2-е 1 000 др", () => {
  const fines = computeViolationFines([
    v({ chat_agr_no: "B-1" }),
    v({ chat_agr_no: "B-2" }),
  ]);
  assert.deepEqual(fines, [0, 1000]);
});

test("один чат со средним И критичным за один день = одно нарушение (флаг «Критичное»), 1-е за день → предупреждение", () => {
  const rows = [
    v({ chat_agr_no: "B-1" }),
    v({ chat_agr_no: "B-1", severity: "Критичное" }),
  ];
  // Один чат = одно нарушение; тяжесть — худшая (флаг), сумма по дневному правилу
  // (это 1-е нарушение за день → предупреждение, 0 др).
  assert.deepEqual(computeViolationFines(rows), [0, 0]);
  const [n] = groupNarusheniya(rows);
  assert.equal(n.severity, "Критичное");
  assert.equal(n.fine, 0);
  assert.equal(n.kind, "warning");
});

test("groupNarusheniya собирает описания проблем чата в один список", () => {
  const [n] = groupNarusheniya([
    v({ chat_agr_no: "B-1", violation_type: "Долгий ответ" }),
    v({ chat_agr_no: "B-1", violation_type: "Игнорирование задач" }),
  ]);
  assert.deepEqual(n.types, ["Долгий ответ", "Игнорирование задач"]);
});
