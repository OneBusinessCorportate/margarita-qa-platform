import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WorkflowError,
  appealStatusFor,
  assertCanAppeal,
  assertCanResolve,
  canAcknowledge,
  validateAppealText,
  violationStatus,
  violationStatusForDecision,
} from "../src/lib/violation-workflow.ts";

test("validateAppealText rejects empty and whitespace-only text", () => {
  assert.throws(() => validateAppealText(""), WorkflowError);
  assert.throws(() => validateAppealText("   \n\t "), WorkflowError);
  assert.throws(() => validateAppealText(undefined), WorkflowError);
  assert.equal(validateAppealText("  не согласен  "), "не согласен");
});

test("violationStatus tolerates legacy rows via appeal_status", () => {
  assert.equal(violationStatus({ status: null, appeal_status: null }), "new");
  assert.equal(violationStatus({ status: null, appeal_status: "appealed" }), "appealed");
  assert.equal(violationStatus({ status: null, appeal_status: "approved" }), "appeal_approved");
  assert.equal(violationStatus({ status: null, appeal_status: "rejected" }), "appeal_rejected");
  assert.equal(violationStatus({ status: "acknowledged", appeal_status: null }), "acknowledged");
});

test("appealStatusFor mirrors workflow status to legacy field", () => {
  assert.equal(appealStatusFor("new"), null);
  assert.equal(appealStatusFor("acknowledged"), null);
  assert.equal(appealStatusFor("appealed"), "appealed");
  assert.equal(appealStatusFor("appeal_approved"), "approved");
  assert.equal(appealStatusFor("appeal_rejected"), "rejected");
});

test("violationStatusForDecision maps decision to violation status", () => {
  assert.equal(violationStatusForDecision("approved"), "appeal_approved");
  assert.equal(violationStatusForDecision("rejected"), "appeal_rejected");
});

test("canAcknowledge only for a brand-new violation (idempotent elsewhere)", () => {
  assert.equal(canAcknowledge({ status: "new", appeal_status: null }), true);
  assert.equal(canAcknowledge({ status: "acknowledged", appeal_status: null }), false);
  assert.equal(canAcknowledge({ status: "appealed", appeal_status: null }), false);
  assert.equal(canAcknowledge({ status: null, appeal_status: "approved" }), false);
});

test("a new violation can be appealed by its owner", () => {
  assert.doesNotThrow(() =>
    assertCanAppeal({ accountant: "Օլյա", status: "new", appeal_status: null }, [], "Օլյա")
  );
});

test("an acknowledged violation can still be appealed (accountant disputes)", () => {
  assert.doesNotThrow(() =>
    assertCanAppeal({ accountant: "Օլյա", status: "acknowledged", appeal_status: null }, [], "Օլյա")
  );
});

test("one violation cannot have two pending appeals", () => {
  const err = assertThrowsWorkflow(() =>
    assertCanAppeal(
      { accountant: "Օլյա", status: "acknowledged", appeal_status: null },
      [{ status: "pending" }],
      "Օլյա"
    )
  );
  assert.equal(err.httpStatus, 409);
});

test("a violation already appealed / resolved cannot be appealed again", () => {
  assert.throws(
    () => assertCanAppeal({ accountant: "Օլյա", status: "appealed", appeal_status: null }, [], "Օլյա"),
    WorkflowError
  );
  assert.throws(
    () => assertCanAppeal({ accountant: "Օլյա", status: "appeal_rejected", appeal_status: null }, [], "Օլյա"),
    WorkflowError
  );
});

test("an accountant cannot appeal another accountant's violation", () => {
  const err = assertThrowsWorkflow(() =>
    assertCanAppeal({ accountant: "Օլյա", status: "new", appeal_status: null }, [], "Դավիթ")
  );
  assert.equal(err.httpStatus, 403);
});

test("Margarita (no accountant actor) may appeal on behalf of the owner", () => {
  assert.doesNotThrow(() =>
    assertCanAppeal({ accountant: "Օլյա", status: "new", appeal_status: null }, [], null)
  );
});

test("a resolved appeal cannot be resolved twice", () => {
  assert.doesNotThrow(() => assertCanResolve({ status: "pending" }));
  const err = assertThrowsWorkflow(() => assertCanResolve({ status: "approved" }));
  assert.equal(err.httpStatus, 409);
  assert.throws(() => assertCanResolve({ status: "rejected" }), WorkflowError);
});

function assertThrowsWorkflow(fn: () => void): WorkflowError {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof WorkflowError, "expected a WorkflowError");
    return e as WorkflowError;
  }
  throw new assert.AssertionError({ message: "expected function to throw" });
}
