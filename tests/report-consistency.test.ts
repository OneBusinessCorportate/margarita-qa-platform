import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildReport } from "../src/lib/report.js";
import { buildReportMessage } from "../src/lib/templates.js";
import { computeViolationFines, groupNarusheniya } from "../src/lib/violations.js";
import { dailyViolationRows, buildLiveViolationBreakdown } from "../src/lib/violation-report.js";
import { seedChats, seedEvaluations, seedTasks } from "../src/lib/seed-data.js";
import type { Violation } from "../src/lib/types.js";

function viol(o: Partial<Violation>): Violation {
  return {
    id: o.id ?? "v", vdate: o.vdate ?? "2026-06-15", accountant: o.accountant ?? null,
    chat_agr_no: o.chat_agr_no ?? null, client: o.client ?? null, severity: o.severity ?? "Среднее",
    violation_type: o.violation_type ?? null, gross: o.gross ?? null, sanction: o.sanction ?? null,
    note: o.note ?? null, confirmed: o.confirmed ?? true, appeal_status: o.appeal_status ?? null,
    created_at: o.created_at ?? "2026-06-15T10:00:00Z",
  };
}

// One canonical report object feeds every presentation. These tests lock in that
// the message formatter, the PDF input model and the dashboard breakdown all
// agree on the numbers (п.7 — «PDF и сообщения используют одну модель»).
describe("report consistency — one canonical pipeline", () => {
  const report = buildReport(seedChats, seedEvaluations, {}, seedTasks, "2026-06-15");

  it("the message shows the report object's own service % and stars from the same object", () => {
    const msg = buildReportMessage(report, {});
    assert.match(msg, new RegExp(`Общий уровень сервиса: ${report.serviceQualityPct}%`));
  });

  const violations: Violation[] = [
    viol({ id: "1", accountant: "Лилит", chat_agr_no: "B-1", violation_type: "поздний ответ", created_at: "2026-06-15T10:00:00Z" }),
    viol({ id: "2", accountant: "Лилит", chat_agr_no: "B-2", violation_type: "грубость", created_at: "2026-06-15T11:00:00Z" }),
    viol({ id: "3", accountant: "Аваг", chat_agr_no: "B-3", violation_type: "долг", sanction: 5000, created_at: "2026-06-15T12:00:00Z" }),
    // second problem in the SAME chat/day for Лилит — must NOT add a new chat row.
    viol({ id: "4", accountant: "Лилит", chat_agr_no: "B-1", violation_type: "ещё одна", created_at: "2026-06-15T13:00:00Z" }),
  ];

  it("message total fine == PDF fine engine total (computeViolationFines)", () => {
    // PDF path (report-pdf.ts) prices with computeViolationFines.
    const pdfFines = computeViolationFines(
      violations.map((v) => ({
        vdate: v.vdate, accountant: v.accountant, severity: v.severity, sanction: v.sanction,
        chat_agr_no: v.chat_agr_no, client: v.client, violation_type: v.violation_type,
      }))
    );
    const pdfTotal = pdfFines.reduce((s, n) => s + n, 0);

    // Message path — parse «Итого штрафов: N др».
    const msg = buildReportMessage(report, { violations });
    const m = msg.match(/Итого штрафов: ([\d\s]+) др/);
    const msgTotal = m ? Number(m[1].replace(/\s/g, "")) : 0;

    assert.equal(msgTotal, pdfTotal, "message and PDF fine totals must match exactly");
  });

  it("dashboard breakdown total == PDF fine engine total (same engine)", () => {
    const breakdown = buildLiveViolationBreakdown(violations);
    const pdfTotal = computeViolationFines(
      violations.map((v) => ({
        vdate: v.vdate, accountant: v.accountant, severity: v.severity, sanction: v.sanction,
        chat_agr_no: v.chat_agr_no, client: v.client, violation_type: v.violation_type,
      }))
    ).reduce((s, n) => s + n, 0);
    assert.equal(breakdown.summary.fineTotal, pdfTotal);
  });

  it("one chat with several problems → ONE row (comma-separated), same in message & breakdown", () => {
    const grouped = groupNarusheniya(
      violations.map((v) => ({
        vdate: v.vdate, accountant: v.accountant, severity: v.severity, sanction: v.sanction,
        chat_agr_no: v.chat_agr_no, client: v.client, violation_type: v.violation_type,
      }))
    );
    // Лилит B-1 collapses two problems into one нарушение.
    const b1 = grouped.filter((n) => n.chat_agr_no === "B-1");
    assert.equal(b1.length, 1, "B-1 must be a single нарушение");
    assert.ok(b1[0].types.length >= 2, "both problem types retained");

    const { violations: dailyRows } = dailyViolationRows(violations);
    const b1Rows = dailyRows.filter((r) => r.chat_agr_no === "B-1");
    assert.equal(b1Rows.length, 1);
    assert.ok((b1Rows[0].violation_type ?? "").includes(","), "types comma-joined in one row");
  });

  it("manual sanction (5000) survives into the message total", () => {
    const msg = buildReportMessage(report, { violations });
    // Аваг's 5000 manual sanction must appear as his fine.
    assert.match(msg, /5\s?000 др/);
  });
});
