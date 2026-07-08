import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEmployeeAudit } from "../src/lib/employee-audit";
import { isValidEmployee } from "../src/lib/valid-employees";

const audit = buildEmployeeAudit();

test("в аудите ровно 14 валидных сотрудников", () => {
  assert.equal(audit.valid.length, 14);
  assert.equal(audit.totals.validCount, 14);
});

test("все нарушения только по валидным сотрудникам", () => {
  for (const v of audit.violations) {
    assert.ok(isValidEmployee(v.employee), `${v.employee} должен быть валиден`);
  }
});

test("невалидные нарушения отброшены, а не посчитаны", () => {
  // 505 исходных строк = валидные + отброшенные
  assert.equal(
    audit.violations.length + audit.totals.droppedViolations,
    audit.meta.violationCount
  );
  assert.ok(audit.totals.droppedViolations > 0);
});

test("Սона/Артак попали в невалидные имена, а не в расчёт", () => {
  const names = audit.invalidNames.map((n) => n.name);
  assert.ok(names.includes("Սոնա"));
  assert.ok(names.includes("Արտակ"));
  // и их нарушения не в валидном журнале
  assert.equal(audit.violations.filter((v) => v.employee === "Սոնա").length, 0);
});

test("Լիլիթ 2 — в ручной проверке", () => {
  assert.ok(audit.reviewNames.some((n) => n.name === "Լիլիթ 2"));
});

test("сумма штрафов = сумме санкций KPI по валидным (77 000 др.)", () => {
  const sum = audit.penalties.reduce((s, p) => s + (p.amount ?? 0), 0);
  assert.equal(sum, audit.totals.penaltiesTotal);
  assert.equal(audit.totals.penaltiesTotal, 77000);
});

test("штрафы не начисляются невалидным сотрудникам", () => {
  for (const p of audit.penalties) {
    assert.ok(isValidEmployee(p.employee));
  }
});

test("бонусы только по валидным и с текстом (не «Нет»)", () => {
  assert.ok(audit.bonuses.length > 0);
  for (const b of audit.bonuses) {
    assert.ok(isValidEmployee(b.employee));
    assert.notEqual(b.text, "Нет");
  }
});

test("Արթուр Բարսеղյан отсутствует в KPI и КК Сопровождении", () => {
  assert.ok(audit.missing.kpi.includes("Արթուր Բարսեղյան"));
  assert.ok(audit.missing.kk.includes("Արթուր Բարսեղյան"));
});

test("матрица источников покрывает все 14", () => {
  assert.equal(audit.sourceMatrix.length, 14);
  assert.ok(audit.sourceMatrix.every((s) => s.inList));
});

test("auditDailyViolations: только за день и только валидные", async () => {
  const { auditDailyViolations } = await import("../src/lib/employee-audit");
  const { violations, fineById } = auditDailyViolations("2026-05-26", "2026-05-26");
  assert.ok(violations.length > 0, "26.05 должны быть нарушения");
  for (const v of violations) {
    assert.equal(v.vdate, "2026-05-26");
    assert.ok(isValidEmployee(v.accountant), `${v.accountant} валиден`);
    assert.equal(typeof fineById[v.id], "number");
  }
  // код чата вытащен из клиента
  assert.ok(violations.some((v) => v.chat_agr_no && /^[BNT]-\d+$/.test(v.chat_agr_no)));
});

test("auditDailyViolations: фильтр по бухгалтеру принимает любое написание", async () => {
  const { auditDailyViolations } = await import("../src/lib/employee-audit");
  // русское написание → маппится на Լիлит
  const ru = auditDailyViolations("2026-05-26", "2026-05-26", "Лилит");
  const arm = auditDailyViolations("2026-05-26", "2026-05-26", "Լիլիթ");
  assert.equal(ru.violations.length, arm.violations.length);
  assert.ok(arm.violations.every((v) => v.accountant === "Լիլիթ"));
});

test("extractChatCode: латиница и кириллица сводятся к одному коду", async () => {
  const { extractChatCode } = await import("../src/lib/employee-audit");
  assert.equal(extractChatCode("ПНХ ООО RU-B-4066"), "B-4066");
  assert.equal(extractChatCode("ИП Блатов/В-4349 RU"), "B-4349"); // кирилл. В → B
  assert.equal(extractChatCode("Рути N-138 RU"), "N-138");
  assert.equal(extractChatCode("ИП Артур Манукян"), null);
});
