// Pure, DB-free rules for the violation → acknowledge / appeal → decision loop.
// Kept side-effect-free so every rule (validation, ownership, allowed
// transitions, status mapping) is unit-testable without a database and shared
// verbatim by the repository (repo.ts) and the API routes. See Phase 2/3/11.

import type {
  AppealStatus,
  Violation,
  ViolationAppeal,
  ViolationStatus,
} from "./types";

/** Normalize a violation's workflow status, tolerating legacy rows. */
export function violationStatus(v: Pick<Violation, "status" | "appeal_status">): ViolationStatus {
  if (v.status) return v.status;
  // Legacy rows only carried appeal_status — derive the workflow status from it.
  switch (v.appeal_status) {
    case "appealed":
      return "appealed";
    case "approved":
      return "appeal_approved";
    case "rejected":
      return "appeal_rejected";
    default:
      return "new";
  }
}

/** Legacy appeal_status mirror for a workflow status (kept in sync in the DB). */
export function appealStatusFor(status: ViolationStatus): string | null {
  switch (status) {
    case "appealed":
      return "appealed";
    case "appeal_approved":
      return "approved";
    case "appeal_rejected":
      return "rejected";
    default:
      return null;
  }
}

/** The violation status a decision resolves to. */
export function violationStatusForDecision(decision: AppealStatus): ViolationStatus {
  return decision === "approved" ? "appeal_approved" : "appeal_rejected";
}

export class WorkflowError extends Error {
  /** Suggested HTTP status: 400 validation, 403 ownership, 409 conflict, 404. */
  readonly httpStatus: number;
  constructor(message: string, httpStatus = 400) {
    super(message);
    this.name = "WorkflowError";
    this.httpStatus = httpStatus;
  }
}

/**
 * Validate free-text appeal explanation. Rejects empty / whitespace-only input
 * and returns the trimmed text. Server-side — never trust the client alone.
 */
export function validateAppealText(text: unknown): string {
  if (typeof text !== "string" || text.trim() === "") {
    throw new WorkflowError("Текст апелляции обязателен", 400);
  }
  return text.trim();
}

/**
 * Whether a violation may still be acknowledged. Idempotent-friendly: only a
 * brand-new violation is acknowledgeable; anything already processed
 * (acknowledged / appealed / resolved) is a no-op, not an error.
 */
export function canAcknowledge(v: Pick<Violation, "status" | "appeal_status">): boolean {
  return violationStatus(v) === "new";
}

/**
 * Assert an appeal may be filed for this violation by this actor. Throws a
 * WorkflowError (with an HTTP hint) otherwise. Rules (Phase 2):
 *   • the violation must exist and be actionable (status `new` or `acknowledged`
 *     — a brand-new violation or one the accountant merely read but still
 *     disputes);
 *   • the actor must own the violation (their accountant name matches) when an
 *     accountant identity is provided;
 *   • no other pending appeal may already exist for the violation.
 */
export function assertCanAppeal(
  v: Pick<Violation, "accountant" | "status" | "appeal_status">,
  existingAppeals: Pick<ViolationAppeal, "status">[],
  actorAccountant?: string | null
): void {
  const status = violationStatus(v);
  if (status === "appealed") {
    throw new WorkflowError("По этому нарушению уже подана апелляция", 409);
  }
  if (status === "appeal_approved" || status === "appeal_rejected") {
    throw new WorkflowError("Апелляция по этому нарушению уже рассмотрена", 409);
  }
  if (existingAppeals.some((a) => a.status === "pending")) {
    throw new WorkflowError("По этому нарушению уже есть апелляция на рассмотрении", 409);
  }
  // Ownership: an accountant may only appeal their own violation. When no actor
  // is supplied (Margarita acting from the back-office) the check is skipped.
  if (
    actorAccountant != null &&
    actorAccountant !== "" &&
    v.accountant != null &&
    v.accountant !== "" &&
    actorAccountant !== v.accountant
  ) {
    throw new WorkflowError("Можно апеллировать только собственное нарушение", 403);
  }
}

/** Assert a decision may be applied to an appeal (must still be pending). */
export function assertCanResolve(appeal: Pick<ViolationAppeal, "status">): void {
  if (appeal.status !== "pending") {
    throw new WorkflowError("Апелляция уже рассмотрена", 409);
  }
}
