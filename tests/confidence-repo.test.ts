import { test } from "node:test";
import assert from "node:assert/strict";
import { createEvaluation, updateEvaluation } from "../src/lib/repo";
import type { NewEvaluationInput } from "../src/lib/types";

// These run against the in-memory store (no Supabase env in CI), exercising the
// same deriveReviewFields logic used in production.

function baseInput(): NewEvaluationInput {
  return {
    chat_agr_no: "CONF-TEST-1",
    period: "202607",
    checking_date: "2026-07-14",
    role: "accountant",
    accountant: "Աննա",
    scores: {
      criteria: { accuracy: 5, sla: 5 },
      ai: { criteria: { accuracy: 5, sla: 5 }, monthly: {}, total: 90, confidence: 88 },
    },
    comment: null,
    total_override: 90,
    ai_confidence: 88,
  };
}

test("createEvaluation records confidence, ai_total and accepted status", async () => {
  const created = await createEvaluation(baseInput(), "margarita@ob.am");
  assert.equal(created.ai_confidence, 88);
  assert.equal(created.ai_total, 90);
  assert.equal(created.review_status, "accepted"); // final matches the AI row
  assert.equal(created.reviewed_by, "margarita@ob.am");
  assert.ok(created.reviewed_at);
});

test("correcting an evaluation preserves the ORIGINAL AI result + confidence", async () => {
  const created = await createEvaluation(baseInput(), "margarita@ob.am");

  // Margarita corrects the total to 70 and (as the panel would) sends the CURRENT
  // model snapshot, which differs from the original. The original must survive.
  const corrected = await updateEvaluation(
    created.id,
    {
      ...baseInput(),
      total_override: 70,
      scores: {
        criteria: { accuracy: 3, sla: 4 },
        ai: { criteria: {}, monthly: {}, total: 50, confidence: 30 }, // decoy new snapshot
      },
      ai_confidence: 30,
    },
    "margarita@ob.am"
  );

  assert.equal(corrected.review_status, "corrected");
  assert.equal(corrected.total_score, 70); // Margarita's final
  // Original AI evaluation + confidence are untouched (not overwritten):
  assert.equal(corrected.ai_confidence, 88);
  assert.equal(corrected.ai_total, 90);
  assert.equal(corrected.scores.ai?.total, 90);
  assert.equal(corrected.scores.ai?.confidence, 88);
  assert.equal(corrected.reviewed_by, "margarita@ob.am");
});

test("evaluation without an AI baseline stays not_reviewed", async () => {
  const created = await createEvaluation(
    {
      chat_agr_no: "CONF-TEST-2",
      period: "202607",
      checking_date: "2026-07-14",
      role: "manager",
      accountant: "Մենեջեր",
      scores: { criteria: { accuracy: 4, sla: 4 } },
      comment: null,
      total_override: 80,
    },
    "margarita@ob.am"
  );
  assert.equal(created.review_status, "not_reviewed");
  assert.equal(created.ai_confidence, null);
});
