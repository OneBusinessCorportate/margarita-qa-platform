// ---------------------------------------------------------------------------
// Pure parsing for the OneBusiness MASTER Google Sheet (the client/agreement/
// invoice workbook), pulled live via src/lib/google-sheet.ts and loaded by
// scripts/sync-sheet.ts.
//
// Two tabs feed the QA platform:
//   «Основные данные»    -> client master fields on mqa_chats (agr_no, hvhh,
//                           name, status, accountant, tax/registration dates)
//   «Import Invoice list» -> per-invoice outstanding amounts, aggregated per
//                           client (by ՀՎՀՀ) into overdue / upcoming debt.
//
// Kept separate from the script (which owns the network + DB I/O) so the column
// mapping and money/date coercion are unit-tested data, not untested glue.
// ---------------------------------------------------------------------------
import { cleanStr, toIsoDate, toNum, chatStatus, type Cell } from "./import-parse";

// --- «Основные данные» → client master -------------------------------------

/** Column positions in the «Основные данные» tab (0-based; header on row 0). */
export const CLIENT_COLS = {
  agr_no: 0, // № договора
  name_agr: 1, // Имя клиента из договора
  hvhh: 3, // ՀՎՀՀ
  name_tax: 4, // Наименование клиента
  status: 6, // Պայմանագրի կարգավիճակ ("Active "/"Inactive ")
  accountant: 7, // Бухгалтер
  tax_activation_date: 8, // Дата активации налогового
  created_date: 9, // Дата регистрации
} as const;

/**
 * The client-master fields this sheet actually carries. NOTE: it has NO chat
 * link and NO chat name — those live only in the QA app — so the sync must
 * upsert exactly these keys and never write chat_link / chat_name / manager,
 * or it would wipe the Telegram links accountants click through to.
 */
export interface MasterClient {
  agr_no: string;
  hvhh: string | null;
  name_agr: string | null;
  name_tax: string | null;
  status: "Active" | "Inactive";
  accountant: string | null;
  tax_activation_date: string | null;
  created_date: string | null;
}

/** Parse one «Основные данные» row; null when there's no contract № (skip it). */
export function parseMasterClientRow(r: Cell[]): MasterClient | null {
  const agr = cleanStr(r[CLIENT_COLS.agr_no]);
  if (!agr) return null;
  return {
    agr_no: agr,
    hvhh: normalizeHvhh(r[CLIENT_COLS.hvhh]),
    name_agr: cleanStr(r[CLIENT_COLS.name_agr]),
    name_tax: cleanStr(r[CLIENT_COLS.name_tax]),
    status: chatStatus(r[CLIENT_COLS.status]),
    accountant: cleanStr(r[CLIENT_COLS.accountant]),
    tax_activation_date: toIsoDate(r[CLIENT_COLS.tax_activation_date]),
    created_date: toIsoDate(r[CLIENT_COLS.created_date]),
  };
}

// --- «Import Invoice list» → debts -----------------------------------------

/** Column positions in the «Import Invoice list» tab (0-based; header on row 0). */
export const INVOICE_COLS = {
  hvhh: 5, // ՀՎՀՀ (join key to a client)
  due_date: 11, // Due Date of Invoice
  outstanding: 14, // "tbP without Bad Debts" = still to be paid (excl. write-offs)
} as const;

export interface DebtTotals {
  overdue: number; // outstanding on invoices due on/before `asOf`
  upcoming: number; // outstanding on invoices due after `asOf`
  total: number;
}

/**
 * ՀՎՀՀ / tax-id key: digits only, zero-padded to 8 (Armenian TINs are 8 digits,
 * and Excel drops the leading zero on ones like "08428944"). Empty → "".
 */
export function normalizeHvhh(v: Cell): string {
  const digits = String(v ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length < 8 ? digits.padStart(8, "0") : digits;
}

/**
 * Aggregate the invoice rows into per-client (by ՀՎՀՀ) debt totals.
 *   outstanding = "tbP without Bad Debts" (what the client still owes us)
 *   overdue     = outstanding on invoices whose due date is on/before `asOf`
 *   upcoming    = outstanding on invoices due after `asOf`
 * An invoice with money owed but no due date counts as overdue (already owed).
 * `startRow` skips the header (default 1).
 */
export function aggregateInvoiceDebts(
  rows: Cell[][],
  asOf: string,
  startRow = 1
): Map<string, DebtTotals> {
  const map = new Map<string, DebtTotals>();
  for (let i = startRow; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const key = normalizeHvhh(r[INVOICE_COLS.hvhh]);
    if (!key) continue;
    const outstanding = toNum(r[INVOICE_COLS.outstanding]) ?? 0;
    if (!(outstanding > 0)) continue; // paid / bad debt / blank → nothing owed
    const due = toIsoDate(r[INVOICE_COLS.due_date]);
    const cur = map.get(key) ?? { overdue: 0, upcoming: 0, total: 0 };
    if (!due || due <= asOf) cur.overdue += outstanding;
    else cur.upcoming += outstanding;
    cur.total += outstanding;
    map.set(key, cur);
  }
  return map;
}

/**
 * The string written to mqa_chats.debts (consumed by the scoring UI): the
 * rounded overdue amount when something is owed now, else "Нет долга". Matches
 * the format debtAmountLabel()/autoDebtStatus() already expect.
 */
export function debtsCellValue(totals: DebtTotals | undefined): string {
  if (totals && totals.overdue > 0) return String(Math.round(totals.overdue));
  return "Нет долга";
}
