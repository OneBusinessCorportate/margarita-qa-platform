import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildViolationWorkflowReport,
  pct,
} from "../src/lib/appeals-report.ts";
import type { Violation, ViolationAppeal } from "../src/lib/types.ts";

function v(over: Partial<Violation> = {}): Violation {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    vdate: "2026-07-10",
    accountant: "Olya",
    chat_agr_no: "B-1",
    client: null,
    severity: "Среднее",
    violation_type: "Долгий ответ",
    gross: null,
    sanction: null,
    note: null,
    confirmed: true,
    status: "new",
    acknowledged_at: null,
    acknowledged_by: null,
    appeal_status: null,
    created_at: "2026-07-10T09:00:00Z",
    ...over,
  };
}

function ap(over: Partial<ViolationAppeal> = {}): ViolationAppeal {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    violation_id: "x",
    accountant: "Olya",
    appeal_text: "текст",
    status: "pending",
    decision_comment: null,
    resolved_by: null,
    created_at: "2026-07-11T09:00:00Z",
    resolved_at: null,
    ...over,
  };
}

test("pct is safe when the denominator is zero", () => {
  assert.equal(pct(0, 0), 0);
  assert.equal(pct(5, 0), 0);
  assert.equal(pct(1, 2), 50);
  assert.equal(pct(1, 3), 33.3);
});

test("counts violations, acknowledgements, unprocessed and appeal states", () => {
  const violations = [
    v({ id: "a", status: "new" }),
    v({ id: "b", status: "acknowledged" }),
    v({ id: "c", status: "appealed", accountant: "David", chat_agr_no: "B-9" }),
    v({ id: "d", status: "appeal_approved", accountant: "David", chat_agr_no: "B-8" }),
    v({ id: "e", status: "appeal_rejected", chat_agr_no: "B-7" }),
  ];
  const appeals = [
    ap({ violation_id: "c", accountant: "David", status: "pending" }),
    ap({ violation_id: "d", accountant: "David", status: "approved" }),
    ap({ violation_id: "e", accountant: "Olya", status: "rejected" }),
  ];
  const r = buildViolationWorkflowReport({ violations, appeals });

  assert.equal(r.violationsCreated, 5);
  assert.equal(r.acknowledged, 1);
  assert.equal(r.unprocessedViolations, 1); // only "a" is new
  assert.equal(r.penaltiesCancelled, 1); // "d" approved
  assert.equal(r.appealsSubmitted, 3);
  assert.equal(r.appealsPending, 1);
  assert.equal(r.appealsApproved, 1);
  assert.equal(r.appealsRejected, 1);
  assert.equal(r.appealsProcessed, 2);
  assert.equal(r.unresolvedAppeals, 1);
  // processed-by-accountant = 4 of 5 (all but "a")
  assert.equal(r.acknowledgementPct, 80);
  // appeal processing = 2 processed / 3 submitted
  assert.equal(r.appealProcessingPct, 66.7);
});

test("percentages are 0 (never NaN) with no violations/appeals", () => {
  const r = buildViolationWorkflowReport({});
  assert.equal(r.appealProcessingPct, 0);
  assert.equal(r.acknowledgementPct, 0);
  assert.equal(r.violationsCreated, 0);
  assert.equal(r.byAccountant.length, 0);
});

test("unconfirmed (auto/legacy) violations are excluded", () => {
  const r = buildViolationWorkflowReport({
    violations: [
      v({ id: "a", status: "new" }),
      v({ id: "b", status: "new", confirmed: false }),
    ],
  });
  assert.equal(r.violationsCreated, 1);
});

test("chatsChecked counts distinct evaluated chats, no double-count", () => {
  const r = buildViolationWorkflowReport({
    evaluations: [
      { chat_agr_no: "B-1", accountant: "Olya", checking_date: "2026-07-10" },
      { chat_agr_no: "B-1", accountant: "Olya", checking_date: "2026-07-11" },
      { chat_agr_no: "B-2", accountant: "Olya", checking_date: "2026-07-11" },
    ],
  });
  assert.equal(r.chatsChecked, 2);
  assert.equal(r.evaluations, 3);
});

test("per-accountant breakdown aggregates the right people", () => {
  const violations = [
    v({ id: "a", accountant: "Olya", status: "acknowledged", chat_agr_no: "B-1" }),
    v({ id: "b", accountant: "Olya", status: "appealed", chat_agr_no: "B-2" }),
    v({ id: "c", accountant: "David", status: "new", chat_agr_no: "B-9" }),
  ];
  const appeals = [ap({ violation_id: "b", accountant: "Olya", status: "pending" })];
  const r = buildViolationWorkflowReport({ violations, appeals });

  // "Olya"/"David" resolve to their canonical (Armenian) rows; key by metric.
  assert.equal(r.byAccountant.length, 2);
  const olya = r.byAccountant.find((x) => x.violations === 2)!;
  assert.ok(olya);
  assert.equal(olya.acknowledgements, 1);
  assert.equal(olya.appealsSubmitted, 1);
  assert.equal(olya.pending, 1);

  const david = r.byAccountant.find((x) => x.violations === 1)!;
  assert.ok(david);
  assert.equal(david.unprocessed, 1);
  assert.equal(r.accountantsWithViolations, 2);
});
