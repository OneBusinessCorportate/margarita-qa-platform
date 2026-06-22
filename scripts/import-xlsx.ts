// ---------------------------------------------------------------------------
// Import Margarita's Google-Sheet export (xlsx) into Supabase.
//
//   npm run import -- --file data/sheet.xlsx [--from 2026-04-15] [--dry-run]
//
// Parses three tabs (column positions match her sheet):
//   Чаты    -> chats          (master client/chat list)
//   Оценка  -> evaluations    (chat scores: 2 daily criteria + 4 monthly
//                              statuses + Общая + comment)
//   Задачи  -> tasks          (single tasks)
//
// --from limits evaluations/tasks to a date range (default: last 35 days of
// data). --dry-run parses + prints a per-accountant/per-day reconciliation
// WITHOUT touching the database (no credentials needed) — use it to compare
// against her "Отчет" tab before loading for real.
// ---------------------------------------------------------------------------
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";
import { TABLES } from "../src/lib/tables";
import {
  parseChatRow,
  parseDebtAmount,
  parseEvalRow,
  toIsoDate as iso,
  cleanStr as str,
  type Cell,
} from "../src/lib/import-parse";

type Row = Cell[];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const DRY = process.argv.includes("--dry-run");
const CHATS_ONLY = process.argv.includes("--chats-only");
const FILE = arg("file") ?? "data/sheet.xlsx";

function sheetRows(wb: XLSX.WorkBook, name: string): Row[] {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`Sheet "${name}" not found. Tabs: ${wb.SheetNames}`);
  return XLSX.utils.sheet_to_json<Row>(ws, { header: 1, raw: true, defval: null });
}

// Hyperlink targets for one column, indexed to match sheet_to_json's row order
// (both start at the sheet's first row). The "Chat LINK" cells are hyperlinks
// whose display text often differs from the real URL, so we must read the
// target, not the text.
function linkColumn(ws: XLSX.WorkSheet, col: number): (string | null)[] {
  const range = XLSX.utils.decode_range(ws["!ref"]!);
  const out: (string | null)[] = [];
  for (let R = range.s.r; R <= range.e.r; R++) {
    const cell = ws[XLSX.utils.encode_cell({ r: R, c: col })] as
      | { l?: { Target?: string } }
      | undefined;
    const href = cell?.l?.Target;
    out[R - range.s.r] = href ? String(href).trim() : null;
  }
  return out;
}

function main() {
  const wb = XLSX.readFile(FILE, { cellDates: true });

  // --- Чаты ---------------------------------------------------------------
  // parseChatRow drops rows with no contract № and never fabricates
  // manager/debts (the source sheet has neither column). See src/lib/import-parse.
  const chatsWs = wb.Sheets["Чаты"];
  if (!chatsWs) throw new Error(`Sheet "Чаты" not found. Tabs: ${wb.SheetNames}`);
  const chatRows = XLSX.utils.sheet_to_json<Row>(chatsWs, {
    header: 1,
    raw: true,
    defval: null,
  });
  const chatLinkHrefs = linkColumn(chatsWs, 9); // "Chat LINK" column (J)
  const chats = chatRows
    .map((r, i) => (i === 0 ? null : parseChatRow(r, chatLinkHrefs[i]))) // row 0 = header
    .filter((c): c is NonNullable<typeof c> => c !== null);
  // de-dupe by agr_no (keep first)
  const chatMap = new Map(chats.map((c) => [c.agr_no, c]));

  // --- Import Debts -> chats.debts ---------------------------------------
  // The actual outstanding amount per contract (ИТОГО ДОЛГ, col 7), so QA can
  // see whether the client has paid. Keyed by № договора (col 0).
  for (const r of sheetRows(wb, "Import Debts").slice(1)) {
    const agr = str(r[0]);
    if (!agr) continue;
    const chat = chatMap.get(agr);
    if (chat) chat.debts = parseDebtAmount(r[7]);
  }

  // --- Оценка -> evaluations ---------------------------------------------
  // parseEvalRow requires a contract № + valid date, maps the four monthly
  // columns, and falls back to the computed score when "Общая" is blank.
  let evaluations = sheetRows(wb, "Оценка 26")
    .slice(2) // header on row 2
    .map(parseEvalRow)
    .filter((e): e is NonNullable<typeof e> => e !== null);

  // --- Задачи -> tasks ----------------------------------------------------
  const taskRows = sheetRows(wb, "Задачи 26").slice(3); // data from row 4
  let tasks = taskRows
    .filter((r) => str(r[0]) && (str(r[14]) || iso(r[12])))
    .map((r) => ({
      chat_agr_no: String(r[0]).trim(),
      type: "single" as const,
      accountant: str(r[4]),
      due_date_original: iso(r[12]),
      due_date_postponed: iso(r[13]),
      description: str(r[14]),
      priority: str(r[15]) ?? "Medium",
      completed_at: iso(r[16]),
      result: str(r[17]),
      task_status: str(r[18]),
      checking_date: iso(r[12]),
      period: (iso(r[12]) ?? "").slice(0, 7).replace("-", "") || null,
    }));

  // --- date range filter --------------------------------------------------
  let from = arg("from");
  if (!from) {
    const maxDate = evaluations.reduce(
      (m, e) => (e.checking_date > m ? e.checking_date : m),
      "0000-00-00"
    );
    const d = new Date(maxDate);
    d.setDate(d.getDate() - 35);
    from = d.toISOString().slice(0, 10);
  }
  evaluations = evaluations.filter((e) => e.checking_date >= from!);
  tasks = tasks.filter((t) => (t.checking_date ?? "9999") >= from!);

  console.log(
    `Parsed: ${chatMap.size} chats, ${evaluations.length} evaluations (from ${from}), ${tasks.length} tasks`
  );

  // --- reconciliation print ----------------------------------------------
  const byDayAcc = new Map<string, { sum: number; n: number; low: number }>();
  for (const e of evaluations) {
    const key = `${e.checking_date}|${e.accountant ?? "—"}`;
    const agg = byDayAcc.get(key) ?? { sum: 0, n: 0, low: 0 };
    agg.sum += e.total_score;
    agg.n += 1;
    if (e.quality_band === "Плохо" || e.quality_band === "Критично") agg.low += 1;
    byDayAcc.set(key, agg);
  }
  const days = [...new Set(evaluations.map((e) => e.checking_date))].sort();
  console.log(`\nReconciliation — ${days.length} day(s):`);
  for (const day of days.slice(-5)) {
    const dayEvals = evaluations.filter((e) => e.checking_date === day);
    const avg = dayEvals.reduce((s, e) => s + e.total_score, 0) / dayEvals.length;
    console.log(`  ${day}: оценено=${dayEvals.length}, Сервис=${avg.toFixed(2)}%`);
  }

  if (DRY) {
    console.log("\n--dry-run: nothing written. Review the numbers above.");
    return;
  }

  // --- upsert -------------------------------------------------------------
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — required to write."
    );
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // accountants: union of chat + evaluation accountants
  const accNames = new Set<string>();
  for (const c of chatMap.values()) if (c.accountant) accNames.add(c.accountant);
  for (const e of evaluations) if (e.accountant) accNames.add(e.accountant);
  const accounts = [...accNames].map((name) => ({
    name,
    active: true,
    role: "accountant" as const,
  }));

  const chunk = <T,>(a: T[], n: number) =>
    Array.from({ length: Math.ceil(a.length / n) }, (_, i) =>
      a.slice(i * n, i * n + n)
    );

  (async () => {
    let e = (await sb.from(TABLES.accountants).upsert(accounts)).error;
    if (e) throw e;
    for (const part of chunk([...chatMap.values()], 500)) {
      e = (await sb.from(TABLES.chats).upsert(part)).error;
      if (e) throw e;
    }
    if (CHATS_ONLY) {
      console.log("Chats-only import complete (evaluations/tasks skipped).");
      return;
    }
    // Upsert (not insert) so re-running the import updates the same row instead
    // of creating duplicates — there is one evaluation per (chat, date, role).
    for (const part of chunk(evaluations, 500)) {
      e = (
        await sb
          .from(TABLES.evaluations)
          .upsert(part, { onConflict: "chat_agr_no,checking_date,role" })
      ).error;
      if (e) throw e;
    }
    for (const part of chunk(tasks, 500)) {
      e = (await sb.from(TABLES.tasks).insert(part)).error;
      if (e) throw e;
    }
    console.log("Import complete.");
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

main();
