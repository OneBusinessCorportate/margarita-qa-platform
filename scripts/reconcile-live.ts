// ---------------------------------------------------------------------------
// Reconcile the authoritative chat list (Excel «Чаты» tab of Margarita's QA
// workbook) against the LIVE platform registry (mqa_chats), so every active
// client chat is either present & correctly mapped, or reported with a concrete
// reason. Read-only: it never writes to the database.
//
//   npm run reconcile:live -- --file <workbook.xlsx> \
//       --url https://<ref>.supabase.co --key <anon-or-service-key>
//
// URL/key also read from NEXT_PUBLIC_SUPABASE_URL + (SUPABASE_SERVICE_ROLE_KEY |
// NEXT_PUBLIC_SUPABASE_ANON_KEY). Optionally --check <id,id,…> to report the
// live status of specific Telegram chat ids (negative group ids preserved).
//
// Reuses the unit-tested pure logic in src/lib/chat-reconcile.ts — this script
// is only the I/O wrapper (read the sheet, read the DB, print the delivery
// report).
// ---------------------------------------------------------------------------
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { TABLES } from "../src/lib/tables";
import {
  reconcileChats,
  computeChatHealth,
  telegramChatIdOf,
  type ReconcileRow,
  type ReconcileClass,
} from "../src/lib/chat-reconcile";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const FILE = arg("file") ?? "data/qa-workbook.xlsx";
const SHEET = arg("sheet") ?? "Чаты";
const URL = arg("url") ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY =
  arg("key") ??
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const CHECK = (arg("check") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// «Чаты» column layout (0-based; header on row 0). The 7th column's header text
// («Не запросил 1») is a leftover — it actually carries the responsible
// accountant, so we read it as such.
const COL = { agr_no: 0, hvhh: 1, name_agr: 2, name_tax: 3, status: 4, accountant: 6, chat_name: 8, chat_link: 9 };

/** Hyperlink targets for a column, indexed by row — the «Chat LINK» cells often
 *  display "Telegram" while the real web.telegram.org URL lives in the href. */
function linkColumn(ws: XLSX.WorkSheet, col: number): (string | null)[] {
  const range = XLSX.utils.decode_range(ws["!ref"]!);
  const out: (string | null)[] = [];
  for (let R = range.s.r; R <= range.e.r; R++) {
    const cell = ws[XLSX.utils.encode_cell({ r: R, c: col })] as { l?: { Target?: string } } | undefined;
    const href = cell?.l?.Target;
    out[R - range.s.r] = href ? String(href).trim() : null;
  }
  return out;
}

function s(v: unknown): string | null {
  const t = v == null ? "" : String(v).trim();
  return t ? t : null;
}

async function main() {
  if (!arg("db-json") && (!URL || !KEY)) {
    console.error("Missing Supabase URL/key. Pass --url/--key, set env vars, or use --db-json.");
    process.exit(1);
  }

  // --- authoritative source: Excel «Чаты» --------------------------------
  const wb = XLSX.read(readFileSync(FILE), { cellDates: true });
  const ws = wb.Sheets[SHEET];
  if (!ws) throw new Error(`Sheet "${SHEET}" not found. Tabs: ${wb.SheetNames.join(", ")}`);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
  const hrefs = linkColumn(ws, COL.chat_link);
  const source: ReconcileRow[] = rows
    .map((r, i): ReconcileRow | null => {
      if (i === 0) return null; // header
      const agr = s(r[COL.agr_no]);
      const chatLinkText = s(r[COL.chat_link]);
      // prefer the real hyperlink target; fall back to the cell text
      const chat_link = hrefs[i] ?? chatLinkText;
      const chat_name = s(r[COL.chat_name]);
      // a row is meaningful if it names a contract, a chat, or a link
      if (!agr && !chat_name && !telegramChatIdOf(chat_link)) return null;
      return {
        agr_no: agr,
        chat_link,
        chat_name,
        accountant: s(r[COL.accountant]),
        status: s(r[COL.status]),
        hvhh: s(r[COL.hvhh]),
        name_agr: s(r[COL.name_agr]),
      };
    })
    .filter((r): r is ReconcileRow => r !== null);

  // --- platform registry: live mqa_chats ---------------------------------
  // Either from a pre-fetched JSON snapshot (--db-json, when anon RLS blocks
  // direct reads) or straight from Supabase.
  const dbJson = arg("db-json");
  let db: ReconcileRow[] = [];
  if (dbJson) {
    db = JSON.parse(readFileSync(dbJson, "utf8")) as ReconcileRow[];
  } else {
    const sb = createClient(URL!, KEY!, { auth: { persistSession: false } });
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb
        .from(TABLES.chats)
        .select("agr_no, chat_link, chat_name, accountant, status, hvhh, name_agr")
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      db.push(...(data as ReconcileRow[]));
      if (data.length < PAGE) break;
    }
  }

  // --- reconcile ----------------------------------------------------------
  const { results, summary } = reconcileChats(source, db);
  const health = computeChatHealth(db);
  const by = (k: ReconcileClass) => results.filter((r) => r.klass === k);

  const line = "─".repeat(72);
  console.log(`\n${line}\nСВЕРКА ЧАТОВ — доставка (источник: «${SHEET}», ${FILE.split("/").pop()})\n${line}`);
  console.log(`Строк обработано (source rows):        ${summary.sourceRows}`);
  console.log(`  из них активных клиентов:            ${summary.activeSource}`);
  console.log(`Зарегистрировано чатов в платформе:    ${db.length} (${health.active} активных)`);
  console.log(`${line}`);
  console.log(`Совпало и корректно привязано:         ${summary.matched}`);
  console.log(`Нужно импортировать (активные, нет):   ${summary.missing}`);
  console.log(`Нужно добавить ссылку (контракт без):  ${summary.linkMissing}`);
  console.log(`Конфликты/на ручную проверку:          ${summary.conflicts}`);
  console.log(`${line}`);
  console.log(`Здоровье реестра платформы:`);
  console.log(`  всего=${health.total} активных=${health.active} неактивных=${health.inactive}`);
  console.log(`  без № договора (TG-)=${health.withoutContract}  без бухгалтера=${health.withoutAccountant}` +
    `  без ссылки=${health.withoutLink}  дубли chat-id=${health.duplicateChatIds}`);

  const dump = (title: string, klass: ReconcileClass, cap = 100) => {
    const list = by(klass);
    if (list.length === 0) return;
    console.log(`\n${line}\n${title} — ${list.length}\n${line}`);
    for (const r of list.slice(0, cap)) {
      const id = telegramChatIdOf(r.source.chat_link);
      console.log(`  [${r.source.agr_no ?? "—"}] ${(r.source.chat_name ?? "").slice(0, 44).padEnd(44)} ` +
        `id=${id ?? "—"}  ${r.reason}`);
    }
    if (list.length > cap) console.log(`  … и ещё ${list.length - cap}`);
  };
  dump("АКТИВНЫЕ, ОТСУТСТВУЮТ В ПЛАТФОРМЕ (импортировать)", "missing");
  dump("КОНТРАКТ ЕСТЬ, НО БЕЗ ССЫЛКИ НА ЧАТ (добавить ссылку)", "link_missing");

  // Conflicts, categorised: separate the harmless "inactive source row that
  // isn't in the platform" (expected — we don't import inactive) from genuine
  // mapping problems that need a human.
  const conflicts = by("conflict");
  const inactiveNotImported = conflicts.filter((r) => r.reason.startsWith("неактивный"));
  const realConflicts = conflicts.filter((r) => !r.reason.startsWith("неактивный"));
  console.log(`\n${line}\nКОНФЛИКТЫ — всего ${conflicts.length}\n${line}`);
  console.log(`  неактивные, отсутствуют — не импортируем (информационно): ${inactiveNotImported.length}`);
  console.log(`  ТРЕБУЮТ РУЧНОЙ ПРОВЕРКИ (реальные): ${realConflicts.length}`);
  for (const r of realConflicts) {
    const id = telegramChatIdOf(r.source.chat_link);
    console.log(`    [${r.source.agr_no ?? "—"}] ${(r.source.chat_name ?? "").slice(0, 40).padEnd(40)} id=${id ?? "—"}  ${r.reason}`);
  }

  // --- specific ids requested for verification ---------------------------
  if (CHECK.length) {
    console.log(`\n${line}\nПРОВЕРКА КОНКРЕТНЫХ CHAT ID\n${line}`);
    const dbById = new Map(db.map((c) => [telegramChatIdOf(c.chat_link), c] as const));
    const srcById = new Map(source.map((c) => [telegramChatIdOf(c.chat_link), c] as const));
    for (const id of CHECK) {
      const inDb = dbById.get(id);
      const inSrc = srcById.get(id);
      console.log(`  ${id}:`);
      console.log(`     платформа: ${inDb ? `${inDb.agr_no} «${inDb.chat_name}» [${inDb.status}]` : "НЕТ"}`);
      console.log(`     источник:  ${inSrc ? `${inSrc.agr_no} «${inSrc.chat_name}» [${inSrc.status}]` : "НЕТ (в Excel отсутствует)"}`);
    }
  }
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
