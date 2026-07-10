import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorkReport, summarizeAppeals } from "../src/lib/work-report";

const evaluations = [
  { chat_agr_no: "B-1", accountant: "Olya", checking_date: "2026-07-01" },
  { chat_agr_no: "B-2", accountant: "Olya", checking_date: "2026-07-01" },
  { chat_agr_no: "B-1", accountant: "Olya", checking_date: "2026-07-02" }, // same chat again
  { chat_agr_no: "B-9", accountant: "David", checking_date: "2026-07-02" },
];
const violations = [
  { accountant: "Olya", vdate: "2026-07-01" },
  { accountant: "David", vdate: "2026-07-02" },
];
const issues = [
  { accountant_name: "Olya Accounting", detected_at: "2026-07-01T10:00:00Z" },
  { accountant_name: "Olya Accounting", detected_at: "2026-07-02T10:00:00Z" },
];
const appeals = [
  { accountant_name: "Olya Accounting", status: "pending", created_at: "2026-07-03T09:00:00Z" },
  { accountant_name: "Olya Accounting", status: "approved", created_at: "2026-07-03T10:00:00Z" },
  { accountant_name: "David Accounting", status: "rejected", created_at: "2026-07-04T10:00:00Z" },
];

test("summarizeAppeals counts each status", () => {
  assert.deepEqual(summarizeAppeals(appeals), { total: 3, pending: 1, approved: 1, rejected: 1 });
});

test("chatsChecked counts distinct chats across evaluations", () => {
  const r = buildWorkReport({ evaluations, violations, issues, appeals });
  // distinct chats: B-1, B-2, B-9 = 3
  assert.equal(r.chatsChecked, 3);
  assert.equal(r.evaluations, 4);
  assert.equal(r.issuesCreated, 2);
  assert.equal(r.violations, 2);
  assert.deepEqual(r.appeals, { total: 3, pending: 1, approved: 1, rejected: 1 });
});

test("byDate buckets by calendar day, newest first", () => {
  const r = buildWorkReport({ evaluations, violations, issues, appeals });
  assert.deepEqual(
    r.byDate.map((d) => d.date),
    ["2026-07-04", "2026-07-03", "2026-07-02", "2026-07-01"]
  );
  const jul1 = r.byDate.find((d) => d.date === "2026-07-01")!;
  assert.equal(jul1.chatsChecked, 2); // B-1, B-2
  assert.equal(jul1.issues, 1);
});

test("byAccountant aggregates volume and appeal outcomes", () => {
  const r = buildWorkReport({ evaluations, violations, issues, appeals });
  const olyaEval = r.byAccountant.find((x) => x.name === "Olya");
  assert.ok(olyaEval, "evaluation row for Olya exists");
  assert.equal(olyaEval!.chatsChecked, 2); // B-1, B-2
  assert.equal(olyaEval!.violations, 1);

  // kk full name doesn't normalize-match the short name → own row
  const olyaAppeals = r.byAccountant.find((x) => x.name === "Olya Accounting");
  assert.ok(olyaAppeals, "appeal row for Olya Accounting exists");
  assert.equal(olyaAppeals!.appeals, 2);
  assert.equal(olyaAppeals!.approved, 1);
  assert.equal(olyaAppeals!.pending, 1);
  assert.equal(olyaAppeals!.issues, 2);
});
