import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateDebts,
  debtsCellValue,
  normalizeAgrNo,
  type DebtRow,
} from "../src/lib/debts";

test("normalizeAgrNo folds Cyrillic homoglyphs and uppercases", () => {
  // Cyrillic В (U+0412) vs Latin B must collapse to the same key.
  assert.equal(normalizeAgrNo("В-4525"), normalizeAgrNo("b-4525"));
  assert.equal(normalizeAgrNo("В-4525"), "B-4525");
  assert.equal(normalizeAgrNo(" 1727 "), "1727");
  assert.equal(normalizeAgrNo(null), "");
});

test("aggregateDebts splits overdue vs upcoming, skips paid/zero", () => {
  const rows: DebtRow[] = [
    { agr_id: "B-1", due_dt: "2026-06-10", debt: "100", status: "active" }, // overdue
    { agr_id: "B-1", due_dt: "2026-07-01", debt: 50, status: "active" }, // upcoming
    { agr_id: "B-1", due_dt: "2026-06-01", debt: 999, status: "paid" }, // ignored
    { agr_id: "В-1", due_dt: "2026-06-09", debt: 25, status: "active" }, // same key (Cyrillic)
    { agr_id: "B-2", due_dt: "2026-06-09", debt: 0, status: "active" }, // zero ignored
  ];
  const m = aggregateDebts(rows, "2026-06-18");
  const b1 = m.get("B-1")!;
  assert.equal(b1.overdue, 125); // 100 + 25 (folded key)
  assert.equal(b1.upcoming, 50);
  assert.equal(b1.total, 175);
  assert.equal(m.has("B-2"), false);
});

test("debtsCellValue matches the UI's expected format", () => {
  assert.equal(debtsCellValue({ overdue: 76000, upcoming: 0, total: 76000 }), "76000");
  assert.equal(debtsCellValue({ overdue: 0, upcoming: 5000, total: 5000 }), "Нет долга");
  assert.equal(debtsCellValue(undefined), "Нет долга");
});
