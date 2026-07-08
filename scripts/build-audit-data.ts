// ---------------------------------------------------------------------------
// Регенерация src/lib/audit-source-data.ts из приложенных Excel-выгрузок.
//
// Запуск:
//   npx tsx scripts/build-audit-data.ts <OB…3.xlsx> <…One_Business.xlsx>
//
// Первый файл — «панель бухгалтерии» с листами «Нарушения», «KPI и результаты»,
// «Проблемы и достижения» (нарушения / бонусы / штрафы). Второй — КК
// Сопровождение (лист «Основные данные»): по нему считаем присутствие
// бухгалтера в клиентской базе. Скрипт извлекает ТОЛЬКО нужные поля — исходные
// книги в репозиторий не кладём (в них персональные данные и они большие).
// ---------------------------------------------------------------------------
import * as XLSX from "xlsx";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

function serial(s: unknown): string | null {
  if (typeof s !== "number") return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(s) * 86400000)
    .toISOString()
    .slice(0, 10);
}
const clean = (v: unknown): string | null =>
  v == null ? null : String(v).replace(/\s+/g, " ").trim() || null;
const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(String(v).replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

const [violFile, kkFile] = process.argv.slice(2);
if (!violFile || !kkFile) {
  console.error("usage: tsx scripts/build-audit-data.ts <OB…3.xlsx> <…One_Business.xlsx>");
  process.exit(1);
}

const wb = XLSX.readFile(violFile);

// --- Нарушения ---
const nrows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets["Нарушения"], {
  header: 1,
  defval: null,
  raw: true,
});
const violations = [];
for (let i = 1; i < nrows.length; i++) {
  const r = nrows[i];
  if (!r || r.every((c: unknown) => c == null)) continue;
  const v = {
    date: serial(r[0]),
    accountant: clean(r[1]),
    client: clean(r[2]),
    severity: clean(r[3]),
    service: clean(r[4]),
    gross: clean(r[5]),
    sanction: typeof r[6] === "number" ? (r[6] as number) : null,
    standard: clean(r[7]),
    description: clean(r[8]),
    resolution: clean(r[9]),
    appeal: clean(r[10]),
  };
  if (!v.date && !v.accountant && !v.client && !v.service && !v.gross) continue;
  violations.push(v);
}

// --- KPI и результаты --- (месячные блоки; индексы колонок из шапки листа) ---
const krows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets["KPI и результаты"], {
  header: 1,
  defval: null,
  raw: false,
});
const MONTHS = [
  { label: "Май 2026", kpi: 6, bonus: 7, sanction: 8 },
  { label: "Апрель 2026", kpi: 15, bonus: 16, sanction: 17 },
  { label: "Март 2026", kpi: 24, bonus: 25, sanction: null },
  { label: "Февраль 2026", kpi: 32, bonus: 33, sanction: null },
  { label: "Январь 2026", kpi: 40, bonus: 41, sanction: null },
];
const kpi = [];
for (let i = 4; i < krows.length; i++) {
  const r = krows[i];
  const name = clean(r?.[0]);
  if (!name || name === "Ср.") continue;
  const grade = clean(r[2]);
  const months: Record<string, any> = {};
  for (const m of MONTHS) {
    const score = num(r[m.kpi]);
    const bonus = clean(r[m.bonus]);
    const sanction = m.sanction != null ? num(r[m.sanction]) : null;
    if (score == null && !bonus && sanction == null) continue;
    months[m.label] = { score, bonus, sanction };
  }
  if (Object.keys(months).length === 0 && !grade) continue;
  kpi.push({ name, grade, months });
}

// --- Проблемы и достижения --- (лист транспонирован: строки = поля) ---
const prows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets["Проблемы и достижения"], {
  header: 1,
  defval: null,
  raw: true,
});
const field = (label: string): any[] =>
  prows.find((r) => clean(r[0])?.startsWith(label)) ?? [];
const idRow = field("1. ID"),
  dateRow = field("2. Дата"),
  typeRow = field("3. Тип"),
  accRow = field("4. Бухгалтер"),
  descRow = field("5. Описание"),
  statusRow = field("11. Статус");
const problems = [];
for (let c = 1; c < 8; c++) {
  const id = clean(idRow[c]);
  if (!id || id === "-") continue;
  problems.push({
    client: id,
    date: serial(dateRow[c]),
    type: clean(typeRow[c]),
    accountant: clean(accRow[c]),
    description: clean(descRow[c]),
    status: clean(statusRow[c]),
  });
}

// --- КК Сопровождение (Основные данные) ---
const kkwb = XLSX.readFile(kkFile);
const kkrows = XLSX.utils.sheet_to_json<any[]>(kkwb.Sheets["Основные данные"], {
  header: 1,
  defval: null,
  raw: false,
});
const kkAll: Record<string, number> = {};
const kkActive: Record<string, number> = {};
for (let i = 1; i < kkrows.length; i++) {
  const r = kkrows[i];
  if (!r) continue;
  const acc = clean(r[7]);
  const st = clean(r[6]);
  if (!acc) continue;
  kkAll[acc] = (kkAll[acc] || 0) + 1;
  if (st && /^active$/i.test(st)) kkActive[acc] = (kkActive[acc] || 0) + 1;
}

const meta = {
  violationSource: "OB (панель бухгалтерии) — лист «Нарушения»",
  kkSource: "One_Business — лист «Основные данные» (КК Сопровождение)",
  violationCount: violations.length,
  dateFrom: violations.reduce<string | null>(
    (a, v) => (v.date && (!a || v.date < a) ? v.date : a),
    null
  ),
  dateTo: violations.reduce<string | null>(
    (a, v) => (v.date && (a === null || v.date > a) ? v.date : a),
    null
  ),
};

const HEADER = `// ---------------------------------------------------------------------------
// СЫРЫЕ данные-источники для аудита сотрудников. Извлечены детерминированно из
// приложенных Excel-файлов скриптом scripts/build-audit-data.ts.
// НЕ редактировать вручную — перегенерировать из свежих выгрузок.
// ---------------------------------------------------------------------------

export interface RawViolation {
  date: string | null;
  accountant: string | null;
  client: string | null;
  severity: string | null;
  service: string | null;
  gross: string | null;
  sanction: number | null;
  standard: string | null;
  description: string | null;
  resolution: string | null;
  appeal: string | null;
}
export interface RawKpiMonth { score: number | null; bonus: string | null; sanction: number | null; }
export interface RawKpi { name: string; grade: string | null; months: Record<string, RawKpiMonth>; }
export interface RawProblem { client: string | null; date: string | null; type: string | null; accountant: string | null; description: string | null; status: string | null; }
export interface AuditSourceData {
  meta: { violationSource: string; kkSource: string; violationCount: number; dateFrom: string | null; dateTo: string | null; };
  violations: RawViolation[];
  kpi: RawKpi[];
  problems: RawProblem[];
  kkAll: Record<string, number>;
  kkActive: Record<string, number>;
}

export const AUDIT_SOURCE: AuditSourceData = `;

const body = JSON.stringify(
  { meta, violations, kpi, problems, kkAll, kkActive },
  null,
  2
);
const outPath = resolve(__dirname, "../src/lib/audit-source-data.ts");
writeFileSync(outPath, HEADER + body + ";\n");
console.log(
  `wrote ${outPath}: ${violations.length} violations, ${kpi.length} kpi, ${problems.length} problems`
);
