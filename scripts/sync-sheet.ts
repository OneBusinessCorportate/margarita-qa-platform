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
//   • Client fields are updated NON-DESTRUCTIVELY — chat_link / chat_name are
//     never written, so the Telegram links accountants use survive.
//   • Manager is AUTO-DETECTED: if the «Основные данные» tab has a column whose
//     header matches «Менеджер»/«Manager», its value is written to
//     mqa_chats.manager — but ONLY for chats that don't already have one
//     (fill-empty), so a manager set by hand in the app is never overwritten.
//     When the column is absent, manager is left exactly as-is (no-op).
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

/**
 * Auto-detect a manager column in a tab by HEADER NAME (не по фикс-индексу, т.к.
 * колонку могут добавить в любом месте) and build agr_no → manager. Returns an
 * empty map when the tab has no «Менеджер»/«Manager» column — then the sync
 * leaves manager untouched. Contract № is column 0 (as everywhere in the sheet).
 */
function managerByAgrFrom(rows: Cell[][]): Map<string, string> {
  const out = new Map<string, string>();
  if (rows.length === 0) return out;
  const header = (rows[0] ?? []).map((c) => String(c ?? ""));
  const mgrCol = header.findIndex((h) => /менедж|manager/i.test(h));
  if (mgrCol < 0) return out;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const agr = String(r[0] ?? "").trim();
    const mgr = String(r[mgrCol] ?? "").trim();
    if (agr && mgr) out.set(agr, mgr);
  }
  return out;
}

async function main() {
  const wb = await loadWorkbook();
  const asOf = arg("as-of") ?? new Date().toISOString().slice(0, 10);

  // --- parse clients ------------------------------------------------------
  const clientRows = rowsOf(wb, CLIENTS_TAB);
  const clients: MasterClient[] = clientRows
    .slice(1)
    .map(parseMasterClientRow)
    .filter((c): c is MasterClient => c !== null);
  // Ответственный менеджер по клиенту — авто-детект по заголовку колонки в
  // «Основные данные» (п.: «задачу назначать и менеджеру, писать имя менеджера
  // автоматически»). Пусто, если колонки нет — тогда manager не трогаем.
  const sheetMgrByAgr = managerByAgrFrom(clientRows);
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

  // Existing chats: agr_no (match target), hvhh (debt join key) and chat_name
  // (carried back into the batched upsert so its NOT NULL constraint is met
  // without ever changing the value).
  let existing: {
    agr_no: string;
    hvhh: string | null;
    chat_name: string;
    accountant: string | null;
    accountant_pinned: boolean | null;
    manager: string | null;
  }[] = [];
  if (sb) {
    const { data, error } = await sb
      .from(TABLES.chats)
      .select("agr_no, hvhh, chat_name, accountant, accountant_pinned, manager")
      .limit(20000);
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

  // Existing chat_name per agr_no — carried back verbatim so the batched upsert
  // satisfies the NOT NULL constraint without ever changing it.
  const nameOf = new Map(existing.map((c) => [c.agr_no, c.chat_name]));

  // Chats whose accountant Margarita pinned in the app (п.1): keep the assigned
  // person, don't overwrite it from «Основные данные». Maps agr_no → pinned
  // accountant so the batched upsert carries the current value back verbatim.
  const pinnedAccOf = new Map(
    existing.filter((c) => c.accountant_pinned).map((c) => [c.agr_no, c.accountant])
  );

  // Existing manager per agr_no — a manager set by hand in the app wins and is
  // carried back verbatim; only chats WITHOUT one are filled from the sheet
  // (fill-empty). Preserves manual assignments, populates the rest automatically.
  const existingMgrOf = new Map(
    existing.map((c) => [c.agr_no, (c.manager ?? "").trim()])
  );
  let managersFilled = 0;
  const managerFor = (agrNo: string): string | null => {
    const current = existingMgrOf.get(agrNo);
    if (current) return current; // manual / already set — never overwrite
    const fromSheet = sheetMgrByAgr.get(agrNo);
    if (fromSheet) {
      managersFilled++;
      return fromSheet;
    }
    return null; // unchanged (was null, stays null)
  };

  // Debt total per client, looked up by its ՀՎՀՀ.
  const asOfStamp = new Date().toISOString();
  const totalsFor = (c: MasterClient): DebtTotals | undefined =>
    debtsByHvhh.get(normalizeHvhh(c.hvhh));

  // Build the chat rows in ONE batched upsert (fast — a few calls, not ~1300
  // round-trips). We DON'T send chat_link, so it's left untouched; chat_name is
  // sent unchanged (existing value, or the agr_no for a new row). manager is
  // sent as the existing value (preserved) or auto-filled from the sheet.
  const consider = ADD_NEW ? [...byAgr.values()] : matched;
  const debtRows: any[] = [];
  let withOverdue = 0;
  const chatRows = consider.map((c) => {
    const totals = totalsFor(c);
    if (totals && totals.overdue > 0) withOverdue++;
    debtRows.push({
      agr_no: c.agr_no,
      overdue: totals?.overdue ?? 0,
      upcoming: totals?.upcoming ?? 0,
      total: totals?.total ?? 0,
      as_of: asOfStamp,
    });
    return {
      agr_no: c.agr_no,
      hvhh: c.hvhh,
      name_agr: c.name_agr,
      name_tax: c.name_tax,
      status: c.status,
      // Pinned chats keep their in-app accountant (п.1); others follow the sheet.
      // The pin flag itself isn't resent — upsert only touches the columns here,
      // so accountant_pinned stays true in the DB.
      accountant: pinnedAccOf.has(c.agr_no) ? pinnedAccOf.get(c.agr_no)! : c.accountant,
      tax_activation_date: c.tax_activation_date,
      created_date: c.created_date,
      debts: debtsCellValue(totals),
      chat_name: nameOf.get(c.agr_no) ?? c.agr_no, // preserve existing / seed new
      manager: managerFor(c.agr_no), // existing wins; else auto-fill from sheet
    };
  });

  for (const part of chunk(chatRows, 500)) {
    const { error } = await sb.from(TABLES.chats).upsert(part, { onConflict: "agr_no" });
    if (error) throw error;
  }
  for (const part of chunk(debtRows, 500)) {
    const { error } = await sb.from(TABLES.debts).upsert(part, { onConflict: "agr_no" });
    if (error) throw error;
  }

  const inserted = ADD_NEW ? fresh.length : 0;
  console.log(
    `\nDone. Clients updated: ${matched.length}` +
      (inserted ? `, inserted: ${inserted}` : "") +
      `. Debts written for ${chatRows.length} chats (${withOverdue} with overdue).` +
      (sheetMgrByAgr.size > 0
        ? ` Managers auto-filled: ${managersFilled} (from ${sheetMgrByAgr.size} in sheet; existing kept).`
        : " Manager column not found in the sheet — managers left unchanged.")
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
