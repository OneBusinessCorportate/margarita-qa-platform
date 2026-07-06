// ---------------------------------------------------------------------------
// PDF version of the daily analytics report — the deep-dive attachment that
// travels with the short Telegram message. The message stays skimmable; the
// PDF carries the analysis: metrics, trend, per-accountant table, critical
// chats with reasons, violations with fines, request volumes and rule-based
// conclusions.
//
// Fonts: DejaVu Sans (vendored in /fonts) — covers Russian AND Armenian, which
// the built-in PDF fonts don't. pdfkit is listed in
// serverComponentsExternalPackages so its font machinery survives bundling.
// (No "server-only" marker: pdfkit itself only runs under Node, and the unit
// test builds a PDF directly.)
// ---------------------------------------------------------------------------
import path from "path";
import PDFDocument from "pdfkit";
import type { DailyReport } from "./report";
import { bandFor } from "./scoring";
import type { Violation } from "./types";

export interface ReportPdfOptions {
  previous?: DailyReport | null;
  violations?: Violation[];
  /** Canonical employee names; people sections are limited to these. */
  roster?: string[];
  requests?: { accountant: string; count: number }[];
  requestDays?: number;
}

const FONT_DIR = path.join(process.cwd(), "fonts");
const PAGE_BOTTOM = 780;

function fmtDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d && m ? `${d}.${m}.${y}` : iso;
}

function periodLabel(report: DailyReport): string {
  const { from, to } = report.filters;
  if (from && to && from !== to) return `${fmtDay(from)} — ${fmtDay(to)}`;
  return fmtDay(to ?? from ?? new Date().toISOString().slice(0, 10));
}

/** Space-separated thousands: 10000 → "10 000". */
function fmtNum(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

type Doc = InstanceType<typeof PDFDocument>;

function ensureRoom(doc: Doc, needed = 40) {
  if (doc.y + needed > PAGE_BOTTOM) doc.addPage();
}

function heading(doc: Doc, text: string) {
  ensureRoom(doc, 60);
  doc.moveDown(1);
  doc.font("Bold").fontSize(13).fillColor("#111").text(text);
  doc.moveDown(0.4);
  doc.font("Regular").fontSize(10).fillColor("#222");
}

function bullet(doc: Doc, text: string) {
  ensureRoom(doc);
  doc.text(`•  ${text}`, { indent: 0, lineGap: 2 });
}

/**
 * Rule-based "Выводы" — the analysis narrative the boss asked to see with the
 * report. Derived deterministically from the same numbers as the message, so
 * it never disagrees with them.
 */
function conclusions(
  report: DailyReport,
  options: ReportPdfOptions,
  scored: { accountant: string; avgScore: number; count: number; lowCount: number }[]
): string[] {
  const out: string[] = [];
  const prev = options.previous;

  if (prev) {
    const d = Math.round((report.serviceQualityPct - prev.serviceQualityPct) * 10) / 10;
    if (d > 0) out.push(`Сервис вырос на ${d} п.п. к прошлому периоду (${prev.serviceQualityPct}% → ${report.serviceQualityPct}%).`);
    else if (d < 0) out.push(`Сервис снизился на ${Math.abs(d)} п.п. к прошлому периоду (${prev.serviceQualityPct}% → ${report.serviceQualityPct}%).`);
    else out.push(`Сервис без изменений к прошлому периоду (${report.serviceQualityPct}%).`);
    const critDiff = report.distribution["Критично"] - prev.distribution["Критично"];
    if (critDiff > 0) out.push(`Критичных оценок больше на ${critDiff} (${prev.distribution["Критично"]} → ${report.distribution["Критично"]}).`);
    else if (critDiff < 0) out.push(`Критичных оценок меньше на ${Math.abs(critDiff)} (${prev.distribution["Критично"]} → ${report.distribution["Критично"]}).`);
  }

  if (report.coveragePct > 0 && report.coveragePct < 95) {
    out.push(`Охват проверок ${report.coveragePct}% — часть активных чатов осталась без оценки.`);
  }

  const meaningful = scored.filter((a) => a.count >= 5);
  if (meaningful.length > 0) {
    const best = meaningful.reduce((m, a) => (a.avgScore > m.avgScore ? a : m));
    const worst = meaningful.reduce((m, a) => (a.avgScore < m.avgScore ? a : m));
    if (best.accountant !== worst.accountant) {
      out.push(`Лучший результат: ${best.accountant} — ${best.avgScore}% (${best.count} чатов).`);
      out.push(`Требует внимания: ${worst.accountant} — ${worst.avgScore}% (${worst.count} чатов${worst.lowCount ? `, низких оценок: ${worst.lowCount}` : ""}).`);
    }
  }

  const crit = report.criticalChats ?? [];
  if (crit.length > 0) {
    const freq = new Map<string, number>();
    for (const c of crit) for (const r of c.reasons) freq.set(r, (freq.get(r) ?? 0) + 1);
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const topStr = top.map(([r, n]) => (n > 1 ? `${r} (×${n})` : r)).join("; ");
    out.push(`Критичных чатов за период: ${crit.length}.${topStr ? ` Основные причины: ${topStr}.` : ""}`);
  } else {
    out.push("Критичных чатов за период нет.");
  }

  const viol = (options.violations ?? []).filter((v) => v.accountant);
  if (viol.length > 0) {
    const fines = viol.reduce((s, v) => s + (typeof v.sanction === "number" && v.sanction > 0 ? v.sanction : 0), 0);
    out.push(`Нарушений за период: ${viol.length}${fines > 0 ? `, штрафы на сумму ${fmtNum(fines)} драм` : ""}.`);
  }

  return out;
}

/** Build the analytics PDF and resolve with its bytes. */
export function buildReportPdf(
  report: DailyReport,
  options: ReportPdfOptions = {}
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 46, bottom: 56, left: 46, right: 46 },
      info: { Title: "Аналитика качества бухгалтерии" },
    });
    doc.registerFont("Regular", path.join(FONT_DIR, "DejaVuSans.ttf"));
    doc.registerFont("Bold", path.join(FONT_DIR, "DejaVuSans-Bold.ttf"));

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const rosterSet =
      options.roster && options.roster.length > 0 ? new Set(options.roster) : null;
    const inRoster = (name: string) => !rosterSet || rosterSet.has(name);
    const scored = report.perAccountant.filter(
      (a) => a.count > 0 && a.avgScore >= 0 && inRoster(a.accountant)
    );

    // ── Header ──────────────────────────────────────────────────────────────
    doc.font("Bold").fontSize(17).fillColor("#111")
      .text("Аналитика качества бухгалтерии");
    doc.font("Regular").fontSize(11).fillColor("#555")
      .text(`Период: ${periodLabel(report)}`);
    doc.moveDown(0.8);

    // ── Key metrics ─────────────────────────────────────────────────────────
    doc.font("Regular").fontSize(10).fillColor("#222");
    const prev = options.previous;
    const trend = prev
      ? ` (прошлый период: ${prev.serviceQualityPct}%)`
      : "";
    doc.text(`Сервис Бухгалтерии: ${report.serviceQualityPct}%${trend}`);
    doc.text(
      `Охват: оценено ${report.totals.evaluatedChats} из ${report.totals.activeChats} активных (${report.coveragePct}%)`
    );
    doc.text(
      `Оценки: Отлично ${report.distribution["Отлично"]} · Хорошо ${report.distribution["Хорошо"]} · ` +
        `Плохо ${report.distribution["Плохо"]} · Критично ${report.distribution["Критично"]}`
    );

    // ── Conclusions ─────────────────────────────────────────────────────────
    heading(doc, "Анализ и выводы");
    for (const line of conclusions(report, options, scored)) bullet(doc, line);

    // ── Per-accountant table ────────────────────────────────────────────────
    heading(doc, "Результаты по бухгалтерам");
    const left = doc.page.margins.left;
    const col = { name: left, score: left + 220, chats: left + 300, low: left + 380 };
    doc.font("Bold").fontSize(9).fillColor("#555");
    const headerY = doc.y;
    doc.text("Бухгалтер", col.name, headerY, { lineBreak: false });
    doc.text("Оценка", col.score, headerY, { lineBreak: false });
    doc.text("Чатов", col.chats, headerY, { lineBreak: false });
    doc.text("Низких", col.low, headerY);
    doc.moveDown(0.2);
    doc.font("Regular").fontSize(10);
    for (const a of [...scored].sort((x, y) => y.avgScore - x.avgScore)) {
      ensureRoom(doc);
      const y = doc.y;
      const band = bandFor(a.avgScore);
      const color =
        band === "Критично" ? "#b91c1c" : band === "Плохо" ? "#b45309" : "#166534";
      doc.fillColor("#222").text(a.accountant, col.name, y, { lineBreak: false, width: 210 });
      doc.fillColor(color).text(`${a.avgScore}%`, col.score, y, { lineBreak: false });
      doc.fillColor("#222").text(String(a.count), col.chats, y, { lineBreak: false });
      doc.text(a.lowCount ? String(a.lowCount) : "—", col.low, y);
    }
    doc.fillColor("#222").text("", left, doc.y); // reset x position

    // ── Critical chats (detail lives here, not in the message) ──────────────
    const crit = report.criticalChats ?? [];
    if (crit.length > 0) {
      heading(doc, `Критичные чаты (${crit.length})`);
      for (const c of crit) {
        ensureRoom(doc);
        const who = c.accountant ? ` — ${c.accountant}` : "";
        const why = c.reasons.length ? `: ${c.reasons.join("; ")}` : ` (оценка ${c.score}%)`;
        bullet(doc, `№${c.chat_agr_no}${c.chat_name ? ` ${c.chat_name}` : ""}${who}${why}`);
      }
    }

    // ── Violations ──────────────────────────────────────────────────────────
    const viol = (options.violations ?? []).filter((v) => v.accountant);
    if (viol.length > 0) {
      heading(doc, "Нарушения");
      for (const v of viol) {
        ensureRoom(doc);
        const parts = [
          v.severity ?? "среднее",
          [v.violation_type, v.note].filter(Boolean).join(" — "),
          typeof v.sanction === "number" && v.sanction > 0
            ? `штраф ${fmtNum(v.sanction)} драм`
            : "",
        ].filter(Boolean);
        bullet(doc, `${v.accountant} (${fmtDay(v.vdate)}): ${parts.join(" · ")}`);
      }
    }

    // ── Requests per day ────────────────────────────────────────────────────
    const reqRows = (options.requests ?? []).filter(
      (r) => r.count > 0 && inRoster(r.accountant)
    );
    if (reqRows.length > 0) {
      const days = options.requestDays && options.requestDays > 1 ? options.requestDays : 1;
      heading(doc, "Кол-во запросов за день");
      for (const r of reqRows) {
        ensureRoom(doc);
        bullet(doc, `${r.accountant} — ${Math.round(r.count / days)}`);
      }
    }

    doc.moveDown(1.5);
    doc.fontSize(8).fillColor("#999")
      .text(`Сформировано автоматически · ${new Date().toISOString().slice(0, 10)}`);

    doc.end();
  });
}
