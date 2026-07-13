import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMasterClientRow,
  aggregateInvoiceDebts,
  debtsCellValue,
  normalizeHvhh,
  CLIENT_COLS,
  INVOICE_COLS,
} from "../src/lib/master-sheet";
import { sheetIdFromUrl, xlsxExportUrl } from "../src/lib/google-sheet";
import type { Cell } from "../src/lib/import-parse";

// --- google-sheet URL handling ---------------------------------------------

test("sheetIdFromUrl extracts the id from a full edit URL and passes a bare id through", () => {
  const url =
    "https://docs.google.com/spreadsheets/d/1HEy3QVrl-gFUtPAnPRpnKp7ZYEHtksgRBXb5PbtE514/edit?gid=1871200091#gid=1871200091";
  assert.equal(sheetIdFromUrl(url), "1HEy3QVrl-gFUtPAnPRpnKp7ZYEHtksgRBXb5PbtE514");
  assert.equal(
    sheetIdFromUrl("1HEy3QVrl-gFUtPAnPRpnKp7ZYEHtksgRBXb5PbtE514"),
    "1HEy3QVrl-gFUtPAnPRpnKp7ZYEHtksgRBXb5PbtE514"
  );
});

test("xlsxExportUrl builds the live export endpoint", () => {
  assert.equal(
    xlsxExportUrl("https://docs.google.com/spreadsheets/d/ABC123DEF456GHI789JK/edit"),
    "https://docs.google.com/spreadsheets/d/ABC123DEF456GHI789JK/export?format=xlsx"
  );
});

test("sheetIdFromUrl throws on nonsense input", () => {
  assert.throws(() => sheetIdFromUrl("not a sheet"));
});

// --- ՀՎՀՀ normalization -----------------------------------------------------

test("normalizeHvhh keeps digits only and zero-pads short (Excel-dropped-zero) ids to 8", () => {
  assert.equal(normalizeHvhh("40134148"), "40134148");
  assert.equal(normalizeHvhh(8428944), "08428944"); // leading zero dropped by Excel → restored
  assert.equal(normalizeHvhh("  00518711 "), "00518711");
  assert.equal(normalizeHvhh(null), "");
  assert.equal(normalizeHvhh("—"), "");
});

// --- client master parsing --------------------------------------------------

function clientRow(over: Partial<Record<number, Cell>> = {}): Cell[] {
  const r: Cell[] = [];
  r[CLIENT_COLS.agr_no] = "1142";
  r[CLIENT_COLS.name_agr] = "ADALYAT NUSSIPAYEVA";
  r[CLIENT_COLS.hvhh] = "40134148";
  r[CLIENT_COLS.name_tax] = "ԱԴԱԼՅԱՏ ՆՈՒՍՍԻՊԱՅԵՎԱ Ա";
  r[CLIENT_COLS.status] = "Active ";
  r[CLIENT_COLS.accountant] = "Ստելլա";
  r[CLIENT_COLS.tax_activation_date] = new Date("2024-05-12T00:00:00Z");
  r[CLIENT_COLS.created_date] = new Date("2023-04-26T00:00:00Z");
  for (const [k, v] of Object.entries(over)) r[Number(k)] = v;
  return r;
}

test("parseMasterClientRow maps the master columns", () => {
  const c = parseMasterClientRow(clientRow())!;
  assert.deepEqual(c, {
    agr_no: "1142",
    hvhh: "40134148",
    name_agr: "ADALYAT NUSSIPAYEVA",
    name_tax: "ԱԴԱԼՅԱՏ ՆՈՒՍՍԻՊԱՅԵՎԱ Ա",
    status: "Active",
    accountant: "Ստելլա",
    tax_activation_date: "2024-05-12",
    created_date: "2023-04-26",
  });
});

test("parseMasterClientRow returns null without a contract № and maps Inactive", () => {
  assert.equal(parseMasterClientRow(clientRow({ [CLIENT_COLS.agr_no]: null })), null);
  assert.equal(parseMasterClientRow(clientRow({ [CLIENT_COLS.status]: "Inactive " }))!.status, "Inactive");
});

test("parseMasterClientRow never fabricates a chat link/name (fields absent)", () => {
  const c = parseMasterClientRow(clientRow())! as unknown as Record<string, unknown>;
  assert.equal("chat_link" in c, false);
  assert.equal("chat_name" in c, false);
  assert.equal("manager" in c, false);
});

// --- invoice debt aggregation -----------------------------------------------

function invoiceRow(hvhh: Cell, due: Cell, outstanding: Cell): Cell[] {
  const r: Cell[] = [];
  r[INVOICE_COLS.hvhh] = hvhh;
  r[INVOICE_COLS.due_date] = due;
  r[INVOICE_COLS.outstanding] = outstanding;
  return r;
}

test("aggregateInvoiceDebts splits overdue vs upcoming and ignores paid invoices", () => {
  const header = invoiceRow("HVHH", "due", "tbp");
  const rows: Cell[][] = [
    header,
    invoiceRow("23361476", "2025-07-15", 0), // paid → ignored
    invoiceRow("23361476", "2026-01-15", 5000), // overdue (<= asOf)
    invoiceRow("23361476", "2026-12-15", 3000), // upcoming (> asOf)
    invoiceRow("00518711", null, 2000), // owed, no due date → overdue
  ];
  const map = aggregateInvoiceDebts(rows, "2026-07-13");
  assert.deepEqual(map.get("23361476"), { overdue: 5000, upcoming: 3000, total: 8000 });
  assert.deepEqual(map.get("00518711"), { overdue: 2000, upcoming: 0, total: 2000 });
});

test("aggregateInvoiceDebts folds multiple invoices per tax-id and skips blank ids", () => {
  const rows: Cell[][] = [
    invoiceRow("HVHH", "due", "tbp"), // header
    invoiceRow("40134148", "2026-01-01", 1000),
    invoiceRow("40134148", "2026-02-01", 500),
    invoiceRow(null, "2026-01-01", 999), // no tax-id → skipped
  ];
  const map = aggregateInvoiceDebts(rows, "2026-07-13");
  assert.deepEqual(map.get("40134148"), { overdue: 1500, upcoming: 0, total: 1500 });
  assert.equal(map.size, 1);
});

test("debtsCellValue: overdue amount when owed now, else «Нет долга»", () => {
  assert.equal(debtsCellValue({ overdue: 1500.4, upcoming: 0, total: 1500.4 }), "1500");
  assert.equal(debtsCellValue({ overdue: 0, upcoming: 900, total: 900 }), "Нет долга");
  assert.equal(debtsCellValue(undefined), "Нет долга");
});
