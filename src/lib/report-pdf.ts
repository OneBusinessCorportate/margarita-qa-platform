// ---------------------------------------------------------------------------
// PDF version of the daily report — the monitoring-spreadsheet grid the
// department keeps by hand: one column group per day (% | ⚠ | N), summary
// rows on top (Оценено чатов, Отлично…Критично, Сервис Бухгалтерии) and one
// row per accountant with colour-coded score cells.
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

export interface ReportPdfOptions {
  /** Canonical employee names — the grid's accountant rows, in this order. */
  roster?: string[];
  /** Violations logged in the window — rendered as the «Нарушения» list. */
  violations?: Violation[];
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

/** Build the day-by-day monitoring grid PDF and resolve with its bytes. */
export function buildReportPdf(
  report: DailyReport,
  options: ReportPdfOptions = {}
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margins: { top: 34, bottom: 34, left: 30, right: 30 },
      info: { Title: "Аналитика качества бухгалтерии" },
    });
    doc.registerFont("Regular", path.join(FONT_DIR, "DejaVuSans.ttf"));
    doc.registerFont("Bold", path.join(FONT_DIR, "DejaVuSans-Bold.ttf"));

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const { from, to } = report.filters;
    const fromISO = from ?? to ?? new Date().toISOString().slice(0, 10);
    const toISO = to ?? fromISO;
    const isMultiDay = fromISO !== toISO;

    // The grid fits ~10 day columns on landscape A4 — keep the LAST 10.
    const allDates = rangeDates(fromISO, toISO);
    const dates = allDates.slice(-10);

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
    const left = doc.page.margins.left;
    const nameW = 130;
    const dayW = { pct: 30, low: 16, n: 16 };
    const dayBlockW = dayW.pct + dayW.low + dayW.n;
    const totalW = isMultiDay ? 40 + 20 : 0;
    const rowH = 15;

    doc.font("Bold").fontSize(14).fillColor(COLORS.text)
      .text("Аналитика качества бухгалтерии", left, doc.y);
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
    drawRow(
      th("Бухгалтер"),
      (d) => [th(fmtShortDate(d))],
      [th("Итого")]
    );
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

    // ── Detail sections (below the grid) ─────────────────────────────────────
    // The grid alone hid "что именно пошло не так": critical chats, the
    // violations log and the unanswered backlog. They are listed here so the PDF
    // carries the full picture the department needs, not just the aggregate.
    const contentW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    doc.y = y + 22;

    const section = (title: string, rows: string[], emptyNote?: string) => {
      // Keep the heading with at least one line of its content on the page.
      if (doc.y + 40 > doc.page.height - doc.page.margins.bottom) doc.addPage();
      doc.moveDown(0.6);
      doc.font("Bold").fontSize(10).fillColor(COLORS.text).text(title, left, doc.y);
      doc.moveDown(0.2);
      doc.font("Regular").fontSize(8).fillColor(COLORS.text);
      if (rows.length === 0) {
        doc.fillColor(COLORS.muted).text(emptyNote ?? "— нет данных —", left, doc.y, { width: contentW });
        return;
      }
      for (const r of rows) {
        doc.text(r, left, doc.y, { width: contentW });
      }
    };

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

    // Ручные правки оценок (п.8) — изменённые оценки за прошлые дни, чтобы они
    // были видны в PDF, а не только внутри панели оценки.
    const overrideRows = (report.manualOverrides ?? []).map((o) => {
      const name = o.chat_name ? ` — ${o.chat_name}` : "";
      const who = o.accountant ?? "—";
      const editedAt = o.edited_at
        ? o.edited_at.slice(0, 16).replace("T", " ")
        : "";
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
      const money = fines[i] > 0 ? ` · ${fines[i].toLocaleString("ru-RU")} др` : " · предупреждение";
      const note = v.note ? ` · «${v.note}»` : "";
      return `• ${v.vdate} · ${who} · ${target} · ${sev}${type}${money}${note}`;
    });
    section(
      `Нарушения за период (${viols.length}, штрафы ${totalFine.toLocaleString("ru-RU")} др)`,
      violRows,
      "Нарушений за период нет ✅"
    );

    // Задачи — per-task detail with the date fields the grid counts hid (п.5):
    // Due Date (Original), Due Date (Postponed), Completed At + менеджер (п.6).
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

    doc.end();
  });
}
