import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chatStatus,
  cleanStr,
  parseChatRow,
  parseEvalRow,
  periodOf,
  toIsoDate,
  toNum,
  type Cell,
} from "../src/lib/import-parse";

// --- cell coercion ---------------------------------------------------------

test("toIsoDate handles Date objects, ISO strings, and guards bad serials", () => {
  assert.equal(toIsoDate(new Date("2026-06-17T09:30:00Z")), "2026-06-17");
  assert.equal(toIsoDate("2026-06-17"), "2026-06-17");
  assert.equal(toIsoDate("2026-06-17T11:00:00Z"), "2026-06-17");
  // Corrupt Excel serial converted to a year outside 2000–2100 → rejected.
  assert.equal(toIsoDate(new Date("1899-12-30")), null);
  assert.equal(toIsoDate(new Date("nonsense")), null);
  assert.equal(toIsoDate("not a date"), null);
  assert.equal(toIsoDate(45000), null); // a raw serial is not a date
  assert.equal(toIsoDate(null), null);
});

test("cleanStr trims and treats blanks / dashes as absent", () => {
  assert.equal(cleanStr("  Фролкин  "), "Фролкин");
  assert.equal(cleanStr(""), null);
  assert.equal(cleanStr("--"), null);
  assert.equal(cleanStr("—"), null);
  assert.equal(cleanStr(null), null);
  assert.equal(cleanStr(undefined), null);
  // Numbers become their string form (contract № can arrive as a number).
  assert.equal(cleanStr(59), "59");
});

test("toNum coerces numbers and numeric strings, rejects junk", () => {
  assert.equal(toNum(4), 4);
  assert.equal(toNum("5"), 5);
  assert.equal(toNum(" 3 "), 3);
  assert.equal(toNum(""), undefined);
  assert.equal(toNum("abc"), undefined);
  assert.equal(toNum("3,5"), undefined); // comma decimal isn't a JS number
  assert.equal(toNum(Number.NaN), undefined);
  assert.equal(toNum(null), undefined);
});

test("chatStatus maps only 'Active…' to Active", () => {
  assert.equal(chatStatus("Active"), "Active");
  assert.equal(chatStatus("Active (paying)"), "Active");
  assert.equal(chatStatus("Inactive"), "Inactive");
  assert.equal(chatStatus("active"), "Inactive"); // case-sensitive, matches sheet
  assert.equal(chatStatus(null), "Inactive");
});

test("periodOf produces a YYYYMM key", () => {
  assert.equal(periodOf("2026-06-17"), "202606");
  assert.equal(periodOf("2026-12-01"), "202612");
});

// --- chat rows -------------------------------------------------------------

test("parseChatRow maps columns and never fabricates manager/debts", () => {
  const row: Cell[] = [
    "59", "01234567", "ООО Ромашка", "ООО Ромашка Налог", "Active",
    new Date("2025-01-10"), "Фролкин", new Date("2024-12-01"),
    "ООО Ромашка / 59", "https://web.telegram.org/a/#-100123",
  ];
  const c = parseChatRow(row)!;
  assert.equal(c.agr_no, "59");
  assert.equal(c.accountant, "Фролкин");
  assert.equal(c.status, "Active");
  assert.equal(c.chat_name, "ООО Ромашка / 59");
  assert.equal(c.chat_link, "https://web.telegram.org/a/#-100123");
  assert.equal(c.tax_activation_date, "2025-01-10");
  // The two bugs that were fixed: manager must NOT equal the accountant, and
  // debts is not invented.
  assert.equal(c.manager, null);
  assert.equal(c.debts, null);
});

test("parseChatRow falls back chat_name to the contract № and skips №-less rows", () => {
  const noName = parseChatRow(["B-3302", null, null, null, "Active"])!;
  assert.equal(noName.chat_name, "B-3302");
  assert.equal(parseChatRow([null, "x", "y"]), null);
  assert.equal(parseChatRow(["", "x"]), null);
});

// --- evaluation rows -------------------------------------------------------

test("parseEvalRow requires a contract № and a valid date", () => {
  assert.equal(parseEvalRow(["59"]), null); // no date in col 8
  assert.equal(parseEvalRow([null]), null);
  // Minimal valid row: № + date only → all-clear defaults to 100.
  const row: Cell[] = [];
  row[0] = "59";
  row[8] = new Date("2026-06-17");
  const e = parseEvalRow(row)!;
  assert.equal(e.chat_agr_no, "59");
  assert.equal(e.checking_date, "2026-06-17");
  assert.equal(e.period, "202606");
  assert.equal(e.role, "accountant");
  assert.equal(e.total_score, 100); // empty criteria → full marks
  assert.equal(e.quality_band, "Отлично");
});

test("parseEvalRow reads criteria, monthly columns and the Общая override", () => {
  const row: Cell[] = new Array(21).fill(null);
  row[0] = "59";
  row[5] = "Фролкин";
  row[8] = new Date("2026-06-17");
  row[9] = 4; // accuracy
  row[10] = 3; // sla
  row[11] = "Отправил"; // main_taxes status
  row[17] = "Нет долга"; // debts status
  row[19] = 88; // Общая override
  row[20] = "ок";
  const e = parseEvalRow(row)!;
  assert.equal(e.accountant, "Фролкин");
  assert.deepEqual(e.scores.criteria, { accuracy: 4, sla: 3 });
  assert.equal(e.scores.monthly.main_taxes.status, "Отправил");
  assert.equal(e.scores.monthly.debts.status, "Нет долга");
  assert.equal(e.total_score, 88); // explicit Общая wins
  assert.equal(e.quality_band, "Хорошо");
  assert.equal(e.comment, "ок");
});

test("parseEvalRow falls back to the hard-gate score when Общая is blank", () => {
  // A failing mailing must force the computed total to 1 (Критично) when the
  // sheet leaves Общая empty — linking import parsing to the scoring engine.
  const row: Cell[] = new Array(21).fill(null);
  row[0] = "59";
  row[8] = new Date("2026-06-17");
  row[9] = 5;
  row[10] = 5;
  row[13] = "Не запросил 1"; // salary fail status
  const e = parseEvalRow(row)!;
  assert.equal(e.total_score, 1);
  assert.equal(e.quality_band, "Критично");
});
