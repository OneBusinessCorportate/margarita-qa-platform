import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildFeedbackAppeals,
  feedbackComment,
  FEEDBACK_SOURCE,
  type FeedbackTicketRow,
} from "../src/lib/appeals-data.js";
import { summarizeAppeals } from "../src/lib/work-report.js";

const tickets: FeedbackTicketRow[] = [
  {
    id: "t1", problem_id: "margarita:abc", accountant_name: "Hasmik",
    situation_comment: "ситуация", solution_comment: "решение", submitted_at: "2026-07-08T14:00:00Z",
  },
  {
    id: "t2", problem_id: "margarita_eval:def", accountant_name: "Lilit",
    situation_comment: "s2", solution_comment: null, submitted_at: "2026-07-07T10:00:00Z",
  },
  {
    id: "t3", problem_id: null, accountant_name: "Naira",
    situation_comment: "no problem link", submitted_at: "2026-07-06T09:00:00Z",
  },
];

describe("appeals — feedback-form import", () => {
  it("imports feedback tickets as pending appeals, preserving source id", () => {
    const appeals = buildFeedbackAppeals(tickets, new Set());
    assert.equal(appeals.length, 3);
    assert.ok(appeals.every((a) => a.status === "pending"));
    assert.ok(appeals.every((a) => a.source === FEEDBACK_SOURCE));
    // original ticket id preserved for traceability
    assert.deepEqual(appeals.map((a) => a.source_id).sort(), ["t1", "t2", "t3"]);
    assert.deepEqual(appeals.map((a) => a.id).sort(), ["t1", "t2", "t3"]);
  });

  it("prevents duplicate import when a decision is already backfilled", () => {
    const appeals = buildFeedbackAppeals(tickets, new Set(["t1"]));
    assert.equal(appeals.length, 2);
    assert.ok(!appeals.some((a) => a.id === "t1"), "t1 already backfilled → skipped");
  });

  it("composes the comment from situation + solution", () => {
    assert.equal(feedbackComment("A", "B"), "Ситуация: A\n\nРешение: B");
    assert.equal(feedbackComment("A", null), "Ситуация: A");
    assert.equal(feedbackComment("", ""), "");
  });

  it("surfaces a malformed ticket (no problem_id) instead of dropping it, and logs it", () => {
    const seen: string[] = [];
    const appeals = buildFeedbackAppeals(tickets, new Set(), (id) => seen.push(id));
    assert.deepEqual(seen, ["t3"]);
    assert.ok(appeals.some((a) => a.id === "t3"), "malformed ticket still surfaced");
  });

  it("counters (total/pending/approved/rejected) reflect imported + decided appeals", () => {
    const imported = buildFeedbackAppeals(tickets, new Set());
    // Simulate two decisions.
    const decided = imported.map((a, i) =>
      i === 0 ? { ...a, status: "approved" as const } : i === 1 ? { ...a, status: "rejected" as const } : a
    );
    const s = summarizeAppeals(decided);
    assert.deepEqual(s, { total: 3, pending: 1, approved: 1, rejected: 1 });
  });
});
