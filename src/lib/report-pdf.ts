// ---------------------------------------------------------------------------
// PDF versions of the accounting report. TWO shapes, matching the two Telegram
// messages so the PDF and the message always agree:
//
//   • mode "daily"  — a single-day report (portrait): «Общий уровень сервиса»,
//     «Звезда дня» and «Кол-во запросов за день» with each accountant's
//     нарушения underneath. Rendered from the SAME buildDailyReportModel the
//     Telegram daily message uses, so the numbers are identical.
//   • mode "weekly" — the day-by-day monitoring grid (landscape): one column
//     group per day (% | ⚠ | N), summary rows on top and one row per
//     accountant with colour-coded score cells, plus the detail sections.
//
// Fonts: DejaVu Sans (vendored in /fonts) — covers Russian AND Armenian,
// which the built-in PDF fonts don't. pdfkit is listed in
// serverComponentsExternalPackages so its font machinery survives bundling.
// (No "server-only" marker: the unit test builds a PDF directly under Node.)
// ---------------------------------------------------------------------------
import path from "path";
import PDFDocument from "pdfkit";
import type { DailyReport, DaySummary } from "./report";
import type { Violation } from "./types";
import { computeViolationFines } from "./violations";
import { buildDailyReportModel, dailyFineLabel } from "./templates";
import { isValidEmployee } from "./valid-employees";

export interface ReportPdfOptions {
  /** Canonical employee names — the grid's accountant rows, in this order. */
  roster?: string[];
  /** Violations logged in the window — rendered as the «Нарушения» list. */
  violations?: Violation[];
  /** Client-request counts per accountant (daily «Кол-во запросов за день»). */
  requests?: { accountant: string; count: number }[];
  /**
   * "daily" = the single-day report matching the Telegram daily message;
   * "weekly" = the day-by-day monitoring grid. Defaults from the report window
   * (single day → daily, range → weekly).
   */
  mode?: "daily" | "weekly";
}

const FONT_DIR = path.join(process.cwd(), "fonts");

// Spreadsheet palette (mirrors scoreCellClass on the /messages page).
interface CellColors {
  bg: string;
  fg: string;
}
interface Palette {
  headerBg: string;
  labelBg: string;
  summaryBg: string;
  green: CellColors;
  plain: CellColors;
  yellow: CellColors;
  red: CellColors;
  excellent: string;
  good: string;
  bad: string;
  critical: string;
  muted: string;
  border: string;
  text: string;
}
const COLORS: Palette = {
  headerBg: "#e5e7eb",
  labelBg: "#f9fafb",
  summaryBg: "#eff6ff",
  green: { bg: "#dcfce7", fg: "#166534" },
  plain: { bg: "#ffffff", fg: "#374151" },
  yellow: { bg: "#fef08a", fg: "#854d0e" },
  red: { bg: "#fecaca", fg: "#b91c1c" },
  excellent: "#f0fdf4",
  good: "#fefce8",
  bad: "#fee2e2",
  critical: "#fecaca",
  muted: "#9ca3af",
  border: "#9ca3af",
  text: "#111827",
};

function scoreColors(score: number): { bg: string; fg: string } {
  if (score >= 98) return COLORS.green;
  if (score >= 90) return COLORS.plain;
  if (score >= 80) return COLORS.yellow;
  return COLORS.red;
}

function fmtShortDate(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}`;
}

function fmtDayFull(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d && m ? `${d}.${m}.${y}` : iso;
}

/** Date as DD.MM.YYYY, or «не указано» when empty (п.5). */
function fmtDateOrUnset(iso: string | null | undefined): string {
  return iso ? fmtDayFull(iso) : "не указано";
}

/** "1 000" — dram amount with space thousand separators. */
function fmtDram(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function rangeDates(from: string, to: string): string[] {
  const result: string[] = [];
  const end = new Date(to + "T00:00:00Z");
  const cur = new Date(from + "T00:00:00Z");
  while (cur <= end) {
    result.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return result;
}

/** A positioned grid cell about to be drawn. */
interface Cell {
  text: string;
  bg: string;
  fg: string;
  bold?: boolean;
  align?: "left" | "center";
}

/**
 * Build the report PDF and resolve with its bytes. Renders the daily report or
 * the weekly grid depending on `options.mode` (defaults from the window).
 */
export function buildReportPdf(
  report: DailyReport,
  options: ReportPdfOptions = {}
): Promise<Buffer> {
  const { from, to } = report.filters;
  const fromISO = from ?? to ?? new Date().toISOString().slice(0, 10);
  const toISO = to ?? fromISO;
  const mode = options.mode ?? (fromISO === toISO ? "daily" : "weekly");

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: mode === "daily" ? "portrait" : "landscape",
      margins: { top: 34, bottom: 34, left: 34, right: 34 },
      info: { Title: "Аналитика качества бухгалтерии" },
    });
    doc.registerFont("Regular", path.join(FONT_DIR, "DejaVuSans.ttf"));
    doc.registerFont("Bold", path.join(FONT_DIR, "DejaVuSans-Bold.ttf"));

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const contentW = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // A flowing detail section: bold heading, then one line per row (or a muted
    // «empty» note). Auto-paginates when it runs off the page.
    const section = (title: string, rows: string[], emptyNote?: string) => {
      if (doc.y + 40 > doc.page.height - doc.page.margins.bottom) doc.addPage();
      doc.moveDown(0.6);
      doc.font("Bold").fontSize(10).fillColor(COLORS.text).text(title, left, doc.y);
      doc.moveDown(0.2);
      doc.font("Regular").fontSize(8).fillColor(COLORS.text);
      if (rows.length === 0) {
        doc.fillColor(COLORS.muted).text(emptyNote ?? "— нет данных —", left, doc.y, { width: contentW });
        return;
      }
      for (const r of rows) doc.text(r, left, doc.y, { width: contentW });
    };

    if (mode === "daily") {
      renderDaily(doc, report, options, left, contentW, section);
    } else {
      renderWeeklyGrid(doc, report, options, fromISO, toISO, left);
      renderDetailSections(doc, report, options, section);
    }

    doc.end();
  });
}

/**
 * Компактная таблица оценок «сотрудник × %» (п.1: общая таблица с оценками всех
 * бухгалтеров, которой в дневном PDF не было). Колонки: имя · Оценка % · Низких
 * (Плохо/Критично) · N (оценено). Цвет ячейки % — как в спреадшите.
 */
function renderScoresTable(
  doc: PDFKit.PDFDocument,
  left: number,
  contentW: number,
  title: string,
  rows: { name: string; pct: number; low: number; count: number }[]
): void {
  if (rows.length === 0) return;
  if (doc.y + 60 > doc.page.height - doc.page.margins.bottom) doc.addPage();
  doc.moveDown(0.6);
  doc.font("Bold").fontSize(11).fillColor(COLORS.text).text(title, left, doc.y);
  doc.moveDown(0.2);

  const rowH = 16;
  const wPct = 70,
    wLow = 55,
    wN = 60;
  const wName = contentW - wPct - wLow - wN;
  const cols: { w: number; align: "left" | "center" }[] = [
    { w: wName, align: "left" },
    { w: wPct, align: "center" },
    { w: wLow, align: "center" },
    { w: wN, align: "center" },
  ];
  let y = doc.y;
  const cell = (
    x: number,
    w: number,
    text: string,
    bg: string,
    fg: string,
    bold: boolean,
    align: "left" | "center"
  ) => {
    doc.rect(x, y, w, rowH).fillAndStroke(bg, COLORS.border);
    doc.font(bold ? "Bold" : "Regular").fontSize(8).fillColor(fg);
    doc.text(text, x + 3, y + 5, { width: w - 6, align, lineBreak: false });
  };

  // Header.
  const header = ["Бухгалтер / сотрудник", "Оценка %", "Низких", "Оценено N"];
  let x = left;
  header.forEach((h, i) => {
    cell(x, cols[i].w, h, COLORS.headerBg, COLORS.text, true, cols[i].align);
    x += cols[i].w;
  });
  y += rowH;

  // Rows.
  for (const r of rows) {
    if (y + rowH > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    const c = r.pct >= 0 ? scoreColors(r.pct) : { bg: "#ffffff", fg: COLORS.muted };
    x = left;
    cell(x, cols[0].w, r.name, COLORS.labelBg, COLORS.text, true, "left");
    x += cols[0].w;
    cell(x, cols[1].w, r.pct >= 0 ? `${r.pct}%` : "—", c.bg, c.fg, true, "center");
    x += cols[1].w;
    cell(
      x,
      cols[2].w,
      r.low ? String(r.low) : "—",
      "#ffffff",
      r.low ? COLORS.red.fg : COLORS.muted,
      false,
      "center"
    );
    x += cols[2].w;
    cell(x, cols[3].w, String(r.count), "#ffffff", "#6b7280", false, "center");
    y += rowH;
  }
  doc.y = y + 4;
}

/** The single-day report — rendered from the shared daily model (matches msg). */
function renderDaily(
  doc: PDFKit.PDFDocument,
  report: DailyReport,
  options: ReportPdfOptions,
  left: number,
  contentW: number,
  section: (title: string, rows: string[], emptyNote?: string) => void
): void {
  const model = buildDailyReportModel(report, {
    violations: options.violations,
    roster: options.roster,
    requests: options.requests,
  });

  doc.font("Bold").fontSize(16).fillColor(COLORS.text).text("Ежедневный отчёт бухгалтерии", left, doc.y);
  doc.moveDown(0.3);
  doc.font("Regular").fontSize(11).fillColor("#374151").text(`Дата: ${model.dateLabel}`, left, doc.y);
  doc.moveDown(0.2);
  const svc = scoreColors(model.servicePct);
  doc.font("Bold").fontSize(12).fillColor(svc.fg)
    .text(`Общий уровень сервиса: ${model.servicePct}% по отделу`, left, doc.y);

  // Общая таблица оценок всех бухгалтеров (п.1) — то, чего в дневном PDF не было.
  const accRows = report.perAccountant
    .filter((a) => isValidEmployee(a.accountant))
    .map((a) => ({
      name: a.accountant,
      pct: a.avgScore,
      low: a.lowCount,
      count: a.count,
    }));
  renderScoresTable(doc, left, contentW, "Оценки бухгалтеров", accRows);

  // Оценки менеджеров (п.2) — показываем, когда менеджер отвечал в чатах и есть
  // оценки; иначе таблица опускается (не засоряем пустой строкой).
  const INVALID = new Set(["-", "—", "--", "#N/A", ""]);
  const mgrRows = (report.managerScores ?? [])
    .filter((m) => m.accountant && !INVALID.has(m.accountant.trim()))
    .map((m) => ({
      name: m.accountant,
      pct: m.avgScore,
      low: m.lowCount,
      count: m.count,
    }));
  renderScoresTable(doc, left, contentW, "Оценки менеджеров", mgrRows);

  // Звезда дня.
  if (model.stars.length) {
    doc.moveDown(0.6);
    doc.font("Bold").fontSize(11).fillColor(COLORS.text).text("Звезда дня", left, doc.y);
    doc.moveDown(0.15);
    doc.font("Regular").fontSize(10).fillColor(COLORS.text);
    for (const s of model.stars) {
      doc.text(`⭐️ ${s.accountant}: ${s.avgScore}% оценка`, left, doc.y, { width: contentW });
    }
  }

  // Кол-во запросов за день + нарушения под каждым бухгалтером.
  if (model.rows.length > 0) {
    doc.moveDown(0.6);
    doc.font("Bold").fontSize(11).fillColor(COLORS.text).text("Кол-во запросов за день", left, doc.y);
    doc.moveDown(0.1);
    for (const row of model.rows) {
      if (doc.y + 28 > doc.page.height - doc.page.margins.bottom) doc.addPage();
      doc.moveDown(0.25);
      doc.font("Bold").fontSize(10).fillColor(COLORS.text)
        .text(`${row.accountant} — ${row.count}`, left, doc.y, { width: contentW });
      if (row.violations.length === 0) {
        doc.font("Regular").fontSize(9).fillColor(COLORS.muted)
          .text("Нарушения: нет", left, doc.y, { width: contentW });
      } else {
        doc.font("Regular").fontSize(9).fillColor(COLORS.text)
          .text("Нарушения:", left, doc.y, { width: contentW });
        for (const item of row.violations) {
          const fg = item.fine > 0 ? COLORS.red.fg : COLORS.text;
          doc.fillColor(fg).text(
            `- ${item.code} — ${item.type} — ${dailyFineLabel(item.fine)}`,
            left + 8,
            doc.y,
            { width: contentW - 8 }
          );
        }
      }
    }
    if (model.totalFine > 0) {
      doc.moveDown(0.3);
      doc.font("Bold").fontSize(10).fillColor(COLORS.text)
        .text(`Итого штрафов: ${fmtDram(model.totalFine)} др`, left, doc.y, { width: contentW });
    }
  }

  // Detail (day-scoped): критичные чаты и задачи. Нарушения уже показаны выше
  // под каждым бухгалтером, отдельный список здесь не дублируем.
  const critRows = report.criticalChats.map((c) => {
    const name = c.chat_name ? ` — ${c.chat_name}` : "";
    const who = c.accountant ?? "—";
    const mgr = ` · Менеджер: ${c.manager || "не указан"}`;
    const why = c.reasons.length ? ` · ${c.reasons.join("; ")}` : "";
    return `• ${c.chat_agr_no}${name} · ${who}${mgr} · ${c.score}%${why}`;
  });
  section(
    `Критичные чаты за день (${report.criticalChats.length})`,
    critRows,
    "Критичных чатов за день нет ✅"
  );

  const taskRows = (report.tasks.items ?? []).map((t) => {
    const who = t.accountant ?? "—";
    const mgr = `Менеджер: ${t.manager || "не указан"}`;
    const desc = t.description ? ` · ${t.description}` : "";
    const status = t.task_status ? ` · ${t.task_status}` : "";
    return `• ${t.chat_agr_no} · ${who} · ${mgr}${status}${desc}`;
  });
  section(
    `Задачи за день (${report.tasks.total} · в срок ${report.tasks.onTime} · опозд. ${report.tasks.late} · просроч. ${report.tasks.overdue})`,
    taskRows,
    "Задач за день нет"
  );

  doc.moveDown(0.8);
  doc.font("Regular").fontSize(7).fillColor(COLORS.muted)
    .text(`сформировано ${new Date().toISOString().slice(0, 10)}`, left, doc.y);
}

/** The day-by-day monitoring grid (landscape) — the weekly report. */
function renderWeeklyGrid(
  doc: PDFKit.PDFDocument,
  report: DailyReport,
  options: ReportPdfOptions,
  fromISO: string,
  toISO: string,
  left: number
): void {
  // The grid fits ~10 day columns on landscape A4 — keep the LAST 10.
  const allDates = rangeDates(fromISO, toISO);
  const dates = allDates.slice(-10);
  const isMultiDay = fromISO !== toISO;

  // ── Data lookups (mirror the /messages page grid) ───────────────────────
  const dayAccMap = new Map<string, { score: number; count: number; low: number }>();
  if (isMultiDay && report.perDayPerAccountant) {
    for (const d of report.perDayPerAccountant) {
      dayAccMap.set(`${d.date}|${d.accountant}`, {
        score: d.avgScore,
        count: d.count,
        low: d.lowCount,
      });
    }
  } else {
    for (const a of report.perAccountant) {
      dayAccMap.set(`${fromISO}|${a.accountant}`, {
        score: a.avgScore,
        count: a.count,
        low: a.lowCount,
      });
    }
  }
  const dayMap = new Map<string, DaySummary>();
  if (isMultiDay && report.perDay) {
    for (const d of report.perDay) dayMap.set(d.date, d);
  } else {
    dayMap.set(fromISO, {
      date: fromISO,
      activeChats: report.totals.activeChats,
      evaluatedChats: report.totals.evaluatedChats,
      newChats: report.totals.newChats,
      distribution: report.distribution,
      serviceQualityPct: report.serviceQualityPct,
    });
  }

  const roster =
    options.roster && options.roster.length > 0
      ? options.roster
      : [...new Set(report.perAccountant.map((a) => a.accountant))];
  const accTotals = new Map(report.perAccountant.map((a) => [a.accountant, a]));

  // ── Layout ──────────────────────────────────────────────────────────────
  const nameW = 130;
  const dayW = { pct: 30, low: 16, n: 16 };
  const dayBlockW = dayW.pct + dayW.low + dayW.n;
  const totalW = isMultiDay ? 40 + 20 : 0;
  const rowH = 15;

  doc.font("Bold").fontSize(14).fillColor(COLORS.text)
    .text("Недельный отчёт бухгалтерии", left, doc.y);
  doc.font("Regular").fontSize(9).fillColor("#6b7280").text(
    `Период: ${fmtDayFull(fromISO)} — ${fmtDayFull(toISO)}` +
      (allDates.length > dates.length
        ? ` (показаны последние ${dates.length} дн.)`
        : "")
  );
  doc.moveDown(0.6);

  let y = doc.y;

  const cellRect = (x: number, w: number, cell: Cell) => {
    doc.rect(x, y, w, rowH).fillAndStroke(cell.bg, COLORS.border);
    doc
      .font(cell.bold ? "Bold" : "Regular")
      .fontSize(7)
      .fillColor(cell.fg);
    doc.text(cell.text, x + 2, y + 4, {
      width: w - 4,
      align: cell.align ?? "center",
      lineBreak: false,
    });
  };

  /** One grid row: label + per-day cell triplets + optional Итого pair. */
  const drawRow = (
    label: Cell,
    perDay: (date: string) => [Cell, Cell, Cell] | [Cell],
    totalCells?: [Cell, Cell] | [Cell]
  ) => {
    if (y + rowH > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    cellRect(left, nameW, { ...label, align: label.align ?? "left" });
    let x = left + nameW;
    for (const d of dates) {
      const cells = perDay(d);
      if (cells.length === 1) {
        cellRect(x, dayBlockW, cells[0]);
      } else {
        cellRect(x, dayW.pct, cells[0]);
        cellRect(x + dayW.pct, dayW.low, cells[1]);
        cellRect(x + dayW.pct + dayW.low, dayW.n, cells[2]);
      }
      x += dayBlockW;
    }
    if (isMultiDay && totalCells) {
      if (totalCells.length === 1) {
        cellRect(x, totalW, totalCells[0]);
      } else {
        cellRect(x, 40, totalCells[0]);
        cellRect(x + 40, 20, totalCells[1]);
      }
    }
    y += rowH;
  };

  const th = (text: string): Cell => ({
    text,
    bg: COLORS.headerBg,
    fg: COLORS.text,
    bold: true,
  });
  const plain = (text: string, bg = "#ffffff", fg = COLORS.text): Cell => ({
    text,
    bg,
    fg,
  });

  // Header row 1: dates.
  drawRow(th("Бухгалтер"), (d) => [th(fmtShortDate(d))], [th("Итого")]);
  // Header row 2: sub-columns.
  drawRow(
    { text: "", bg: COLORS.headerBg, fg: COLORS.text },
    () => [th("%"), th("⚠"), th("N")],
    [th("%"), th("N")]
  );

  // ── Summary rows ────────────────────────────────────────────────────────
  const summary = (
    label: string,
    value: (d: DaySummary) => string,
    total: string,
    labelBg = COLORS.labelBg,
    cellBg = "#ffffff"
  ) =>
    drawRow(
      { text: label, bg: labelBg, fg: COLORS.text, bold: true },
      (d) => {
        const day = dayMap.get(d);
        return [plain(day ? value(day) : "—", cellBg, day ? COLORS.text : COLORS.muted)];
      },
      [plain(total, cellBg, COLORS.text)]
    );

  summary(
    "Чаты без ответственных",
    () => "—",
    String(report.totals.chatsWithoutResponsible || "—")
  );
  summary(
    "Активных чатов",
    (d) => (d.activeChats !== undefined ? String(d.activeChats) : "—"),
    String(report.totals.activeChats),
    COLORS.summaryBg
  );
  summary(
    "Оценено чатов всего",
    (d) => String(d.evaluatedChats),
    String(report.totals.evaluatedChats),
    COLORS.summaryBg
  );
  summary("Отлично", (d) => String(d.distribution["Отлично"]), String(report.distribution["Отлично"]), COLORS.excellent);
  summary("Хорошо", (d) => String(d.distribution["Хорошо"]), String(report.distribution["Хорошо"]), COLORS.good);
  summary("Плохо", (d) => String(d.distribution["Плохо"]), String(report.distribution["Плохо"]), COLORS.bad);
  summary("Критично", (d) => String(d.distribution["Критично"]), String(report.distribution["Критично"]), COLORS.critical);

  // Сервис Бухгалтерии — bold, colour-coded like the sheet.
  drawRow(
    { text: "Сервис Бухгалтерии", bg: COLORS.headerBg, fg: COLORS.text, bold: true },
    (d) => {
      const day = dayMap.get(d);
      if (!day || day.evaluatedChats === 0)
        return [plain("—", "#ffffff", COLORS.muted)];
      const c = scoreColors(day.serviceQualityPct);
      return [{ text: String(day.serviceQualityPct), bg: c.bg, fg: c.fg, bold: true }];
    },
    [
      {
        text: String(report.serviceQualityPct),
        bg: scoreColors(report.serviceQualityPct).bg,
        fg: scoreColors(report.serviceQualityPct).fg,
        bold: true,
      },
    ]
  );

  // ── Per-accountant rows ─────────────────────────────────────────────────
  for (const acc of roster) {
    const t = accTotals.get(acc);
    drawRow(
      { text: acc, bg: COLORS.labelBg, fg: COLORS.text, bold: true },
      (d) => {
        const cell = dayAccMap.get(`${d}|${acc}`);
        if (!cell || cell.score < 0) {
          return [
            plain("—", "#ffffff", COLORS.muted),
            plain("", "#ffffff", COLORS.muted),
            plain("", "#ffffff", COLORS.muted),
          ];
        }
        const c = scoreColors(cell.score);
        return [
          { text: String(cell.score), bg: c.bg, fg: c.fg },
          plain(cell.low ? String(cell.low) : "", "#ffffff", COLORS.red.fg),
          plain(String(cell.count), "#ffffff", "#6b7280"),
        ];
      },
      t && t.avgScore >= 0
        ? [
            {
              text: String(t.avgScore),
              bg: scoreColors(t.avgScore).bg,
              fg: scoreColors(t.avgScore).fg,
              bold: true,
            },
            plain(String(t.count), "#ffffff", "#6b7280"),
          ]
        : [plain("—", "#ffffff", COLORS.muted), plain("", "#ffffff", COLORS.muted)]
    );
  }

  doc.font("Regular").fontSize(7).fillColor(COLORS.muted).text(
    `% — средняя оценка · ⚠ — низкие оценки (Плохо/Критично) · N — оценено чатов · сформировано ${new Date().toISOString().slice(0, 10)}`,
    left,
    y + 8
  );
  doc.y = y + 22;
}

/** Detail sections below the weekly grid — the full picture the grid hides. */
function renderDetailSections(
  doc: PDFKit.PDFDocument,
  report: DailyReport,
  options: ReportPdfOptions,
  section: (title: string, rows: string[], emptyNote?: string) => void
): void {
  // Критичные чаты — with the responsible manager and a manual-override note.
  const critRows = report.criticalChats.map((c) => {
    const name = c.chat_name ? ` — ${c.chat_name}` : "";
    const who = c.accountant ?? "—";
    const mgr = ` · Менеджер: ${c.manager || "не указан"}`;
    const why = c.reasons.length ? ` · ${c.reasons.join("; ")}` : "";
    const manual = c.manualOverride
      ? ` · ✎ оценка изменена вручную (${c.manualOverride.old_score ?? "—"}→${c.manualOverride.new_score}): «${c.manualOverride.comment}»`
      : "";
    return `• ${c.chat_agr_no}${name} · ${who}${mgr} · ${c.score}%${why}${manual}`;
  });
  section(
    `Критичные чаты за период (${report.criticalChats.length})`,
    critRows,
    "Критичных чатов за период нет ✅"
  );

  // Ручные правки оценок (п.8) — изменённые оценки за прошлые дни.
  const overrideRows = (report.manualOverrides ?? []).map((o) => {
    const name = o.chat_name ? ` — ${o.chat_name}` : "";
    const who = o.accountant ?? "—";
    const editedAt = o.edited_at ? o.edited_at.slice(0, 16).replace("T", " ") : "";
    const by = o.changed_by
      ? ` (${o.changed_by}${editedAt ? `, ${editedAt}` : ""})`
      : editedAt
        ? ` (${editedAt})`
        : "";
    const date = fmtDateOrUnset(o.score_date);
    return (
      `• ${o.chat_agr_no}${name} · ${who} · за ${date} · ` +
      `${o.old_score ?? "—"}→${o.new_score}${by}` +
      (o.comment ? ` · «${o.comment}»` : "")
    );
  });
  section(
    `Ручные правки оценок за период (${(report.manualOverrides ?? []).length})`,
    overrideRows,
    "Оценки за период вручную не менялись ✅"
  );

  // Нарушения — with the reviewer's comment and the computed fine.
  const viols = options.violations ?? [];
  const fines = computeViolationFines(
    viols.map((v) => ({
      vdate: v.vdate,
      accountant: v.accountant,
      severity: v.severity,
      sanction: v.sanction,
      chat_agr_no: v.chat_agr_no,
      client: v.client,
      violation_type: v.violation_type,
    }))
  );
  const totalFine = fines.reduce((s, n) => s + n, 0);
  const violRows = viols.map((v, i) => {
    const who = v.accountant ?? "—";
    const target = v.client ?? v.chat_agr_no ?? "—";
    const sev = v.severity ?? "—";
    const type = v.violation_type ? ` · ${v.violation_type}` : "";
    const money = fines[i] > 0 ? ` · ${fmtDram(fines[i])} др` : " · предупреждение";
    const note = v.note ? ` · «${v.note}»` : "";
    return `• ${v.vdate} · ${who} · ${target} · ${sev}${type}${money}${note}`;
  });
  section(
    `Нарушения за период (${viols.length}, штрафы ${fmtDram(totalFine)} др)`,
    violRows,
    "Нарушений за период нет ✅"
  );

  // Задачи — per-task detail with the date fields the grid counts hid (п.5).
  const taskRows = (report.tasks.items ?? []).map((t) => {
    const who = t.accountant ?? "—";
    const mgr = `Менеджер: ${t.manager || "не указан"}`;
    const desc = t.description ? ` · ${t.description}` : "";
    const status = t.task_status ? ` · ${t.task_status}` : "";
    return (
      `• ${t.chat_agr_no} · ${who} · ${mgr}${status}${desc}\n` +
      `    Due Date (Original): ${fmtDateOrUnset(t.due_date_original)}` +
      ` · Due Date (Postponed): ${fmtDateOrUnset(t.due_date_postponed)}` +
      ` · Completed At: ${fmtDateOrUnset(t.completed_at)}`
    );
  });
  section(
    `Задачи за период (${report.tasks.total} · в срок ${report.tasks.onTime} · опозд. ${report.tasks.late} · просроч. ${report.tasks.overdue})`,
    taskRows,
    "Задач за период нет"
  );
}
