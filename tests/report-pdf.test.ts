import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReportPdf } from "../src/lib/report-pdf";
import { buildReport } from "../src/lib/report";
import { seedChats, seedEvaluations, seedTasks } from "../src/lib/seed-data";

test("buildReportPdf produces a valid PDF with all sections' data", async () => {
  const report = buildReport(seedChats, seedEvaluations, {}, seedTasks, "2026-06-15");
  const previous = {
    ...report,
    serviceQualityPct: report.serviceQualityPct - 2,
    filters: { from: "2026-06-08", to: "2026-06-14" },
  };
  const bytes = await buildReportPdf(report, {
    previous,
    violations: [
      {
        id: "1", vdate: "2026-06-15", accountant: "Լիլիթ", chat_agr_no: null,
        client: null, severity: "Среднее", violation_type: "Просрочка ответа",
        gross: null, sanction: 10000, note: null, created_at: "2026-06-15T10:00:00Z",
      },
    ],
    requests: [{ accountant: "Անի", count: 99 }],
    requestDays: 1,
  });
  // A real PDF: magic bytes + EOF marker + a non-trivial size (fonts embedded).
  assert.equal(bytes.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.ok(bytes.subarray(-32).toString("latin1").includes("%%EOF"));
  assert.ok(bytes.length > 10_000, `PDF is suspiciously small: ${bytes.length} bytes`);
});

test("buildReportPdf works without optional data (no violations / requests / previous)", async () => {
  const report = buildReport(seedChats, seedEvaluations, {}, seedTasks, "2026-06-15");
  const bytes = await buildReportPdf(report);
  assert.equal(bytes.subarray(0, 5).toString("latin1"), "%PDF-");
});
