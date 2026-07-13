// ---------------------------------------------------------------------------
// Sync the OneBusiness MASTER Google Sheet LIVE into Supabase — no manual
// "download as Excel" step. Reads the sheet straight from Google's export
// endpoint each run, so the platform always sees the current data.
//
//   npm run sync:sheet -- --dry-run        # fetch live, print reconciliation, write NOTHING
//   npm run sync:sheet                      # update existing clients' master fields + debts
//   npm run sync:sheet -- --add-new         # also INSERT clients not yet in the QA app
//   npm run sync:sheet -- --url <sheetUrl>  # override the source sheet
//   npm run sync:sheet -- --file path.xlsx  # read a local file instead of fetching (offline)
//
// Source sheet: --url, else $SOURCE_SHEET_URL, else the built-in default below.
//
// SAFE BY DESIGN:
//   • Client fields are updated NON-DESTRUCTIVELY — chat_link / chat_name /
//     manager are never written, so the Telegram links accountants use survive.
//   • New clients are only added with --add-new (otherwise the sheet's full
//     company list won't flood the QA app with chats Margarita doesn't score).
//   • Debts write only the amount (mqa_chats.debts + mqa_debts totals); the
//     «Долги» follow-up status is left to the existing contact-log logic.
//   • --dry-run touches nothing and needs no DB credentials — use it to check
//     the numbers against the sheet's own «Report» tab before writing.
// ---------------------------------------------------------------------------
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { TABLES } from "../src/lib/tables";
import { fetchSheetXlsx } from "../src/lib/google-sheet";
import {
  parseMasterClientRow,
  aggregateInvoiceDebts,
  debtsCellValue,
  normalizeHvhh,
  type MasterClient,
  type DebtTotals,
} from "../src/lib/master-sheet";
import type { Cell } from "../src/lib/import-parse";

const DEFAULT_SHEET =
  "https://docs.google.com/spreadsheets/d/1HEy3QVrl-gFUtPAnPRpnKp7ZYEHtksgRBXb5PbtE514/edit";

const CLIENTS_TAB = "Основные данные";
const INVOICES_TAB = "Import Invoice list";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const DRY = process.argv.includes("--dry-run");
const ADD_NEW = process.argv.includes("--add-new");

function rowsOf(wb: XLSX.WorkBook, name: string): Cell[][] {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`Tab "${name}" not found. Tabs: ${wb.SheetNames.join(", ")}`);
  return XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: null });
}

async function loadWorkbook(): Promise<XLSX.WorkBook> {
  const file = arg("file");
  if (file) {
    console.log(`Reading local file ${file} …`);
    return XLSX.read(readFileSync(file), { cellDates: true });
  }
  const src = arg("url") ?? process.env.SOURCE_SHEET_URL ?? DEFAULT_SHEET;
  console.log(`Fetching live sheet: ${src}`);
  const buf = await fetchSheetXlsx(src);
  console.log(`  got ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB`);
  return XLSX.read(buf, { cellDates: true });
}

async function main() {
  const wb = await loadWorkbook();
  const asOf = arg("as-of") ?? new Date().toISOString().slice(0, 10);

  // --- parse clients ------------------------------------------------------
  const clients: MasterClient[] = rowsOf(wb, CLIENTS_TAB)
    .slice(1)
    .map(parseMasterClientRow)
    .filter((c): c is MasterClient => c !== null);
  // de-dupe by agr_no (keep first)
  const byAgr = new Map<string, MasterClient>();
  for (const c of clients) if (!byAgr.has(c.agr_no)) byAgr.set(c.agr_no, c);

  // --- parse + aggregate debts (by ՀՎՀՀ) ----------------------------------
  const debtsByHvhh = aggregateInvoiceDebts(rowsOf(wb, INVOICES_TAB), asOf);
  const overdueClients = [...debtsByHvhh.values()].filter((t) => t.overdue > 0).length;

  console.log(
    `\nParsed ${byAgr.size} clients from «${CLIENTS_TAB}», ` +
      `debts for ${debtsByHvhh.size} tax-ids (${overdueClients} with overdue) from «${INVOICES_TAB}».`
  );

  // --- read the QA app's existing chats to reconcile the join -------------
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const canWrite = Boolean(url && key);

  if (!canWrite && !DRY) {
    console.error(
      "\nMissing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — cannot write. " +
        "Re-run with --dry-run to preview, or set the credentials."
    );
    process.exit(1);
  }

  const sb = canWrite ? createClient(url!, key!, { auth: { persistSession: false } }) : null;

  // Existing chats: agr_no (match target) + hvhh (debt join key).
  let existing: { agr_no: string; hvhh: string | null }[] = [];
  if (sb) {
    const { data, error } = await sb.from(TABLES.chats).select("agr_no, hvhh").limit(20000);
    if (error) throw error;
    existing = (data ?? []) as typeof existing;
  } else {
    console.log("(no credentials — reconciliation shown against the sheet only)");
  }

  const existingAgr = new Set(existing.map((c) => c.agr_no));
  const matched = [...byAgr.values()].filter((c) => existingAgr.has(c.agr_no));
  const fresh = [...byAgr.values()].filter((c) => !existingAgr.has(c.agr_no));

  // How many existing chats a debt total will land on, and multi-contract tax-ids.
  const chatsByHvhh = new Map<string, string[]>();
  for (const c of existing) {
    const h = normalizeHvhh(c.hvhh);
    if (!h) continue;
    (chatsByHvhh.get(h) ?? chatsByHvhh.set(h, []).get(h)!).push(c.agr_no);
  }
  const sharedHvhh = [...chatsByHvhh.values()].filter((v) => v.length > 1).length;

  console.log(
    `\nReconciliation (as of ${asOf}):\n` +
      (sb ? `  existing chats in QA app: ${existing.length}\n` : "") +
      `  sheet clients matching an existing chat: ${matched.length}\n` +
      `  sheet clients NOT yet in the app:        ${fresh.length}` +
      (ADD_NEW ? " (will be inserted)" : " (skipped — pass --add-new to insert)") +
      "\n" +
      (sb
        ? `  tax-ids shared by >1 chat (debt lands on each): ${sharedHvhh}\n`
        : "")
  );

  if (DRY) {
    console.log("--dry-run: nothing written. Review the numbers above.");
    return;
  }
  if (!sb) return;

  // --- write: client master (non-destructive) -----------------------------
  const chunk = <T,>(a: T[], n: number) =>
    Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

  // Accountants referenced by the sheet, so scoring has them.
  const accNames = new Set<string>();
  for (const c of byAgr.values()) if (c.accountant) accNames.add(c.accountant);
  const accounts = [...accNames].map((name) => ({
    name,
    active: true,
    role: "accountant" as const,
  }));
  {
    const { error } = await sb.from(TABLES.accountants).upsert(accounts);
    if (error) throw error;
  }

  // UPDATE existing chats: upsert with ONLY master-field keys, so chat_link /
  // chat_name / manager are untouched (they aren't in the payload).
  for (const part of chunk(matched, 500)) {
    const { error } = await sb.from(TABLES.chats).upsert(part, { onConflict: "agr_no" });
    if (error) throw error;
  }

  // INSERT brand-new clients (opt-in): give them a chat_name (required) and no link.
  let inserted = 0;
  if (ADD_NEW && fresh.length) {
    const rows = fresh.map((c) => ({ ...c, chat_name: c.agr_no, chat_link: null, manager: null }));
    for (const part of chunk(rows, 500)) {
      const { error } = await sb.from(TABLES.chats).upsert(part, { onConflict: "agr_no" });
      if (error) throw error;
    }
    inserted = rows.length;
  }

  // --- write: debts (amount only; follow-up status left alone) -------------
  const debtRows: any[] = [];
  const chatUpdates: { agr_no: string; debts: string }[] = [];
  let withOverdue = 0;
  const consider = ADD_NEW ? [...byAgr.values()] : matched;
  // Look up each client's debt totals by its ՀՎՀՀ.
  const hvhhOf = new Map(consider.map((c) => [c.agr_no, normalizeHvhh(c.hvhh)]));
  for (const c of consider) {
    const totals: DebtTotals | undefined = debtsByHvhh.get(hvhhOf.get(c.agr_no) ?? "");
    debtRows.push({
      agr_no: c.agr_no,
      overdue: totals?.overdue ?? 0,
      upcoming: totals?.upcoming ?? 0,
      total: totals?.total ?? 0,
      as_of: new Date().toISOString(),
    });
    if (totals && totals.overdue > 0) withOverdue++;
    chatUpdates.push({ agr_no: c.agr_no, debts: debtsCellValue(totals) });
  }
  for (const part of chunk(debtRows, 500)) {
    const { error } = await sb.from(TABLES.debts).upsert(part, { onConflict: "agr_no" });
    if (error) throw error;
  }
  for (const u of chatUpdates) {
    const { error } = await sb.from(TABLES.chats).update({ debts: u.debts }).eq("agr_no", u.agr_no);
    if (error) throw error;
  }

  console.log(
    `\nDone. Clients updated: ${matched.length}` +
      (inserted ? `, inserted: ${inserted}` : "") +
      `. Debts written for ${chatUpdates.length} chats (${withOverdue} with overdue).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
