// ---------------------------------------------------------------------------
// Pure parsing / normalization for the xlsx importer (scripts/import-xlsx.ts).
//
// Kept out of the script so the column mapping and cell coercion — the bits
// that decide what actually lands in the database — are unit-tested data, not
// untested glue. The script keeps the I/O (reading the workbook, upserting).
// ---------------------------------------------------------------------------
import { bandFor, computeOverall } from "./scoring";

/** A raw cell value as produced by xlsx with { cellDates: true }. */
export type Cell = string | number | Date | null | undefined;

/** Coerce a cell to an ISO date (YYYY-MM-DD), guarding corrupt Excel serials. */
export function toIsoDate(v: Cell): string | null {
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    if (Number.isNaN(v.getTime()) || y < 2000 || y > 2100) return null;
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
}

/** Trim a cell to a non-empty string; treat "", "--" and "—" as absent (null). */
export function cleanStr(v: Cell): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" || s === "--" || s === "—" ? null : s;
}

/**
 * The real chat link. In Margarita's sheet the "Chat LINK" cell is usually a
 * hyperlink whose DISPLAY text differs from its target — e.g. it reads
 * "Telegram" or the chat's name while the actual web.telegram.org URL lives in
 * the hyperlink. sheet_to_json only yields the display text, so we must prefer
 * the hyperlink target and fall back to the display text only when the cell has
 * no hyperlink (a plain URL typed in, or a note like "не работаем").
 */
export function resolveChatLink(display: Cell, hyperlink?: Cell): string | null {
  return cleanStr(hyperlink) ?? cleanStr(display);
}

/** Coerce a cell to a number, or undefined when it isn't numeric. */
export function toNum(v: Cell): number | undefined {
  if (typeof v === "number") return Number.isNaN(v) ? undefined : v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)))
    return Number(v);
  return undefined;
}

/** Map the sheet's status text to the strict Active/Inactive enum. */
export function chatStatus(v: Cell): "Active" | "Inactive" {
  return (cleanStr(v) ?? "").startsWith("Active") ? "Active" : "Inactive";
}

/** YYYYMM period key from an ISO date (e.g. "2026-06-17" -> "202606"). */
export function periodOf(isoDate: string): string {
  return isoDate.slice(0, 7).replace("-", "");
}

/** The four monthly mailing columns: [category id, status col, prev col]. */
export const MONTHLY_COLS: [string, number, number][] = [
  ["main_taxes", 11, 12],
  ["salary", 13, 14],
  ["primary_docs", 15, 16],
  ["debts", 17, 18],
];

/**
 * Normalize a debt amount from the "Import Debts" sheet (the "ИТОГО ДОЛГ"
 * column): a positive amount becomes its rounded string; zero/negative/blank
 * becomes "Нет долга" (paid up). Returns null when the cell isn't a number.
 */
export function parseDebtAmount(itogoDolg: Cell): string | null {
  const n = toNum(itogoDolg);
  if (n === undefined) return null;
  return n > 0 ? String(Math.round(n)) : "Нет долга";
}

export interface ParsedChat {
  agr_no: string;
  hvhh: string | null;
  name_agr: string | null;
  name_tax: string | null;
  status: "Active" | "Inactive";
  tax_activation_date: string | null;
  accountant: string | null;
  created_date: string | null;
  chat_name: string;
  chat_link: string | null;
  manager: string | null;
  debts: string | null;
}

/**
 * Parse one "Чаты" row. Returns null when there's no contract № (the row is
 * skipped). manager/debts are intentionally null: the source sheet has neither
 * a manager column nor a debt-amount column (copying the accountant into
 * manager was the old bug).
 */
export function parseChatRow(r: Cell[], linkHref?: Cell): ParsedChat | null {
  if (!cleanStr(r[0])) return null;
  const agr_no = String(r[0]).trim();
  return {
    agr_no,
    hvhh: cleanStr(r[1]),
    name_agr: cleanStr(r[2]),
    name_tax: cleanStr(r[3]),
    status: chatStatus(r[4]),
    tax_activation_date: toIsoDate(r[5]),
    accountant: cleanStr(r[6]),
    created_date: toIsoDate(r[7]),
    chat_name: cleanStr(r[8]) ?? agr_no,
    // Prefer the cell's hyperlink target over its display text (see resolveChatLink).
    chat_link: resolveChatLink(r[9], linkHref),
    manager: null,
    debts: null,
  };
}

export interface ParsedEval {
  chat_agr_no: string;
  period: string;
  checking_date: string;
  role: "accountant";
  accountant: string | null;
  scores: {
    criteria: Record<string, number>;
    monthly: Record<string, { status: string; prev: string }>;
  };
  total_score: number;
  quality_band: ReturnType<typeof bandFor>;
  comment: string | null;
}

/**
 * Parse one "Оценка" row. Returns null unless it has a contract № AND a valid
 * checking date. The total falls back to the computed score (hard gate +
 * weighted criteria) when the sheet's "Общая" cell is blank.
 */
export function parseEvalRow(r: Cell[]): ParsedEval | null {
  const checking_date = toIsoDate(r[8]);
  if (!cleanStr(r[0]) || !checking_date) return null;

  const criteria: Record<string, number> = {};
  const a = toNum(r[9]);
  const s = toNum(r[10]);
  if (a !== undefined) criteria.accuracy = a;
  if (s !== undefined) criteria.sla = s;

  const monthly: Record<string, { status: string; prev: string }> = {};
  for (const [id, sc, pc] of MONTHLY_COLS) {
    monthly[id] = { status: cleanStr(r[sc]) ?? "", prev: cleanStr(r[pc]) ?? "--" };
  }

  const overall = toNum(r[19]);
  const total = overall !== undefined ? overall : computeOverall(criteria, monthly);

  return {
    chat_agr_no: String(r[0]).trim(),
    period: periodOf(checking_date),
    checking_date,
    role: "accountant",
    accountant: cleanStr(r[5]),
    scores: { criteria, monthly },
    total_score: total,
    quality_band: bandFor(total),
    comment: cleanStr(r[20]),
  };
}
