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
import { bandFor, computeOverall } from "../src/lib/scoring";

type Row = (string | number | Date | null | undefined)[];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const DRY = process.argv.includes("--dry-run");
const CHATS_ONLY = process.argv.includes("--chats-only");
const FILE = arg("file") ?? "data/sheet.xlsx";

const iso = (v: unknown): string | null => {
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    if (Number.isNaN(v.getTime()) || y < 2000 || y > 2100) return null; // guard corrupt serials
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
};
const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" || s === "--" ? null : s;
};
const num = (v: unknown): number | undefined => {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)))
    return Number(v);
  return undefined;
};

function sheetRows(wb: XLSX.WorkBook, name: string): Row[] {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`Sheet "${name}" not found. Tabs: ${wb.SheetNames}`);
  return XLSX.utils.sheet_to_json<Row>(ws, { header: 1, raw: true, defval: null });
}

function main() {
  const wb = XLSX.readFile(FILE, { cellDates: true });

  // --- Чаты ---------------------------------------------------------------
  const chatRows = sheetRows(wb, "Чаты").slice(1); // skip header
  const chats = chatRows
    .filter((r) => str(r[0]))
    .map((r) => ({
      agr_no: String(r[0]).trim(),
      hvhh: str(r[1]),
      name_agr: str(r[2]),
      name_tax: str(r[3]),
      status: (str(r[4]) ?? "").startsWith("Active") ? "Active" : "Inactive",
      tax_activation_date: iso(r[5]),
      accountant: str(r[6]), // col 7 holds the accountant in her sheet
      created_date: iso(r[7]),
      chat_name: str(r[8]) ?? String(r[0]).trim(),
      chat_link: str(r[9]),
      // The source "Чаты" sheet has no manager column — do NOT copy the
      // accountant here (that mislabelled every chat's manager). Managers are
      // captured from real manager-role evaluations instead. Map a real column
      // here if one is added to the sheet.
      manager: null as string | null,
      // No debt-amount column in the source sheet; the per-evaluation "Долги"
      // status (Оценка cols 17/18) carries the debt follow-up state instead.
      debts: null as string | null,
    }));
  // de-dupe by agr_no (keep first)
  const chatMap = new Map(chats.map((c) => [c.agr_no, c]));

  // --- Оценка -> evaluations ---------------------------------------------
  const evalRows = sheetRows(wb, "Оценка 26").slice(2); // header on row 2
  const MONTHLY_COLS: [string, number, number][] = [
    ["main_taxes", 11, 12],
    ["salary", 13, 14],
    ["primary_docs", 15, 16],
    ["debts", 17, 18],
  ];
  let evaluations = evalRows
    .filter((r) => str(r[0]) && iso(r[8]))
    .map((r) => {
      const criteria: Record<string, number> = {};
      const a = num(r[9]);
      const s = num(r[10]);
      if (a !== undefined) criteria.accuracy = a;
      if (s !== undefined) criteria.sla = s;
      const monthly: Record<string, { status: string; prev: string }> = {};
      for (const [id, sc, pc] of MONTHLY_COLS) {
        monthly[id] = { status: str(r[sc]) ?? "", prev: str(r[pc]) ?? "--" };
      }
      const checking_date = iso(r[8])!;
      const overall = num(r[19]);
      const total =
        overall !== undefined ? overall : computeOverall(criteria, monthly);
      return {
        chat_agr_no: String(r[0]).trim(),
        period: checking_date.slice(0, 7).replace("-", ""),
        checking_date,
        accountant: str(r[5]),
        scores: { criteria, monthly },
        total_score: total,
        quality_band: bandFor(total),
        comment: str(r[20]),
      };
    });

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
