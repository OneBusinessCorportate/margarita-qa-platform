import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VALID_EMPLOYEES,
  resolveEmployee,
  isValidEmployee,
  canonicalShortName,
} from "../src/lib/valid-employees";

test("ровно 14 действующих сотрудников", () => {
  assert.equal(VALID_EMPLOYEES.length, 14);
  assert.ok(VALID_EMPLOYEES.every((e) => e.active));
});

test("армянские короткие имена сопоставляются", () => {
  assert.equal(canonicalShortName("Գայանե"), "Գայանե");
  assert.equal(canonicalShortName("Ավագ"), "Ավագ");
  assert.equal(canonicalShortName("Դավիթ"), "Դավիթ");
});

test("русские / английские транслитерации маппятся на того же человека", () => {
  assert.equal(canonicalShortName("Гаяне"), "Գայանե");
  assert.equal(canonicalShortName("Аваг"), "Ավագ");
  assert.equal(canonicalShortName("David"), "Դավիթ");
  assert.equal(canonicalShortName("Артур"), "Արթուր");
});

test("варианты точки-сокращения считаются одним человеком", () => {
  // U+2024 (․) из БД и обычная точка из Excel
  assert.equal(canonicalShortName("Նաիրա Մ․"), "Նաիրա Մ․");
  assert.equal(canonicalShortName("Նաիրա Մ."), "Նաիրա Մ․");
  assert.equal(canonicalShortName("Լիլիթ Ք."), "Լիլիթ Ք․");
  assert.equal(canonicalShortName("Լիլիթ Ք․"), "Լիլիթ Ք․");
});

test("опечатка Առփինե (Ռ вместо Ր) → Арпине", () => {
  assert.equal(canonicalShortName("Առփինե"), "Արփինե");
});

test("голая Լիլիթ и Լիլիթ Ք. — разные люди", () => {
  assert.notEqual(canonicalShortName("Լիլիթ"), canonicalShortName("Լիլիթ Ք․"));
});

test("уволенные / чужие / служебные имена невалидны", () => {
  for (const n of ["Արտակ", "Սոնա", "Տաթև", "Էմիլյա", "Գայանե Դ․", "հանձնված"]) {
    assert.equal(isValidEmployee(n), false, `${n} должно быть невалидно`);
    assert.equal(resolveEmployee(n).status, "invalid", `${n} → invalid`);
  }
});

test("Լիլիթ 2 уходит в ручную проверку, а не приклеивается к Лилит", () => {
  assert.equal(resolveEmployee("Լիլիթ 2").status, "review");
  assert.equal(isValidEmployee("Լիլիթ 2"), false);
});

test("пустые значения — unassigned, не сотрудник", () => {
  for (const n of ["", "-", "—", "#N/A", null, undefined]) {
    assert.equal(resolveEmployee(n as any).status, "unassigned");
  }
});

test("неизвестное имя → review (не гадаем)", () => {
  assert.equal(resolveEmployee("Иван Петров").status, "review");
});
