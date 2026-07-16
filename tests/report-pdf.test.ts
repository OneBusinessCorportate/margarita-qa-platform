import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReportPdf } from "../src/lib/report-pdf";
import { buildReport } from "../src/lib/report";
import { seedChats, seedEvaluations, seedTasks } from "../src/lib/seed-data";

test("buildReportPdf renders the multi-day monitoring grid", async () => {
  const report = buildReport(
    seedChats,
    seedEvaluations,
    { from: "2026-06-09", to: "2026-06-15" },
    seedTasks,
    "2026-06-15"
  );
  const bytes = await buildReportPdf(report, {
    roster: ["Անի", "Նաիրա", "Լիլիթ"],
  });
  // A real PDF: magic bytes + EOF marker + a non-trivial size (fonts embedded).
  assert.equal(bytes.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.ok(bytes.subarray(-32).toString("latin1").includes("%%EOF"));
  assert.ok(bytes.length > 10_000, `PDF is suspiciously small: ${bytes.length} bytes`);
});

test("buildReportPdf handles a single-day report without a roster", async () => {
  const report = buildReport(
    seedChats,
    seedEvaluations,
    { from: "2026-06-15", to: "2026-06-15" },
    seedTasks,
    "2026-06-15"
  );
  const bytes = await buildReportPdf(report);
  assert.equal(bytes.subarray(0, 5).toString("latin1"), "%PDF-");
});

test("daily PDF renders the all-accountants trend grid from a multi-day trend report", async () => {
  const report = buildReport(
    seedChats,
    seedEvaluations,
    { from: "2026-06-15", to: "2026-06-15" },
    seedTasks,
    "2026-06-15"
  );
  // A week-to-date trend report drives the dynamics grid (score per day + Δ).
  const trend = buildReport(
    seedChats,
    seedEvaluations,
    { from: "2026-06-09", to: "2026-06-15" },
    seedTasks,
    "2026-06-15"
  );
  const roster = [...new Set(trend.perAccountant.map((a) => a.accountant))];
  const bytes = await buildReportPdf(report, { roster, trend, mode: "daily" });
  assert.equal(bytes.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.ok(bytes.subarray(-32).toString("latin1").includes("%%EOF"));
  assert.ok(bytes.length > 10_000, `PDF is suspiciously small: ${bytes.length} bytes`);
});
