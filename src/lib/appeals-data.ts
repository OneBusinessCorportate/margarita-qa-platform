// Data access for the accountant-appeal loop. Appeals are filed in the
// accountant app against a QA issue (a row in the shared `kk_problems` table)
// and stored in `kk_problems`/`kk_problem_appeals` — NOT the mqa_ tables — so we
// read them directly by name through the service client (same way repo.ts reads
// the shared `messages` table). When Supabase isn't configured (local/CI) these
// degrade to empty rather than throwing.

import { getServiceClient } from "./supabase/server";
import { listEvaluations, listViolations } from "./repo";
import { buildWorkReport, type WorkReport } from "./work-report";

const APPEALS_TABLE = "kk_problem_appeals";
const PROBLEMS_TABLE = "kk_problems";
const FEEDBACK_TABLE = "kk_accountant_feedback";
const MARGARITA_SOURCE = "margarita_review";
/** Source tag for appeals imported from the accountant feedback form. */
export const FEEDBACK_SOURCE = "accountant_feedback";

export interface Appeal {
  id: string;
  problem_id: string;
  accountant_id: string | null;
  accountant_name: string | null;
  comment: string;
  status: "pending" | "approved" | "rejected";
  resolved_by: string | null;
  resolution_comment: string | null;
  created_at: string;
  resolved_at: string | null;
  /** Origin of the appeal: null = native, 'accountant_feedback' = feedback form. */
  source?: string | null;
  /** Original source ticket id (kk_accountant_feedback.id) — traceability. */
  source_id?: string | null;
  // Joined from kk_problems for display:
  problem_title: string | null;
  problem_source: string | null;
  problem_status: string | null;
  client_name: string | null;
  chat_link: string | null;
}

/** Compose the appeal comment from a feedback ticket's situation + solution. */
export function feedbackComment(situation?: string | null, solution?: string | null): string {
  const parts: string[] = [];
  if (situation && situation.trim()) parts.push(`Ситуация: ${situation.trim()}`);
  if (solution && solution.trim()) parts.push(`Решение: ${solution.trim()}`);
  return parts.join("\n\n");
}

/** A raw kk_accountant_feedback row (subset used to build an appeal). */
export interface FeedbackTicketRow {
  id: string;
  problem_id: string | null;
  accountant_id?: string | null;
  accountant_name?: string | null;
  situation_comment?: string | null;
  solution_comment?: string | null;
  submitted_at?: string | null;
  created_at?: string | null;
}

/**
 * Map feedback-form tickets to pending appeals, skipping any already backfilled
 * into kk_problem_appeals (deduped by source_id). Pure + deterministic so the
 * import rules (dedup, source-id preservation, safe handling of a missing
 * problem_id) are unit-testable without a database. `onMalformed` is called for
 * tickets with no problem_id (logged, not dropped).
 */
export function buildFeedbackAppeals(
  feedback: FeedbackTicketRow[],
  backfilledSourceIds: Set<string>,
  onMalformed?: (id: string) => void
): Appeal[] {
  const out: Appeal[] = [];
  for (const f of feedback) {
    if (backfilledSourceIds.has(f.id)) continue; // decision already persisted
    if (!f.problem_id) onMalformed?.(f.id);
    out.push({
      id: f.id,
      problem_id: f.problem_id ?? "",
      accountant_id: f.accountant_id ?? null,
      accountant_name: f.accountant_name ?? null,
      comment: feedbackComment(f.situation_comment, f.solution_comment),
      status: "pending",
      resolved_by: null,
      resolution_comment: null,
      created_at: f.submitted_at ?? f.created_at ?? new Date(0).toISOString(),
      resolved_at: null,
      source: FEEDBACK_SOURCE,
      source_id: f.id,
      problem_title: null,
      problem_source: null,
      problem_status: null,
      client_name: null,
      chat_link: null,
    });
  }
  return out;
}

export interface AppealFilters {
  status?: string;
  accountant?: string;
}

/**
 * All appeals (newest first), each enriched with its disputed issue's details.
 * Two sources are unified so every accountant appeal is visible in one place:
 *   1. native appeals in kk_problem_appeals (incl. rows backfilled from feedback);
 *   2. accountant feedback-form tickets (kk_accountant_feedback) that have not
 *      yet been backfilled — surfaced as «pending» appeals, deduped by source_id.
 * Malformed tickets (no problem_id) are logged and shown, never silently lost.
 */
export async function listAppeals(filters: AppealFilters = {}): Promise<Appeal[]> {
  const sb = getServiceClient();
  if (!sb) return [];

  // 1. Native appeals (no status filter in the query — merge + filter in JS so
  //    the feedback-derived appeals are filtered by the same rules).
  const { data: nativeData, error } = await sb
    .from(APPEALS_TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) throw error;
  const native = (nativeData ?? []) as any[];
  const backfilledSourceIds = new Set(
    native.map((a) => a.source_id).filter(Boolean) as string[]
  );

  // 2. Feedback-form tickets → virtual pending appeals (skip already backfilled).
  const { data: fbData, error: fbErr } = await sb
    .from(FEEDBACK_TABLE)
    .select("id, problem_id, accountant_id, accountant_name, situation_comment, solution_comment, submitted_at, created_at")
    .order("submitted_at", { ascending: false })
    .limit(5000);
  if (fbErr) throw fbErr;
  const feedbackAppeals = buildFeedbackAppeals(
    (fbData ?? []) as FeedbackTicketRow[],
    backfilledSourceIds,
    (id) => console.warn(`kk_accountant_feedback ${id}: no problem_id — surfaced without linkage`)
  );

  const merged = [...native, ...feedbackAppeals];

  // Enrich with the disputed problem's details.
  const ids = [...new Set(merged.map((a) => a.problem_id).filter(Boolean))];
  const problems = new Map<string, any>();
  if (ids.length) {
    const { data: probs, error: pe } = await sb
      .from(PROBLEMS_TABLE)
      .select("problem_id, problem_title, source, client_name, chat_link, status")
      .in("problem_id", ids);
    if (pe) throw pe;
    for (const p of probs ?? []) problems.set(p.problem_id, p);
  }

  let out: Appeal[] = merged.map((a) => {
    const p = problems.get(a.problem_id) ?? {};
    return {
      ...a,
      problem_title: p.problem_title ?? null,
      problem_source: p.source ?? null,
      problem_status: p.status ?? null,
      client_name: p.client_name ?? null,
      chat_link: p.chat_link ?? null,
    } as Appeal;
  });

  if (filters.status) out = out.filter((a) => a.status === filters.status);
  if (filters.accountant) out = out.filter((a) => a.accountant_name === filters.accountant);
  out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return out;
}

/**
 * Approve or reject an appeal and mirror the decision onto the disputed issue,
 * exactly like the accountant app: approving dismisses the issue (marks it a
 * false positive so it leaves the dashboard); rejecting keeps it active.
 */
export async function updateAppeal(
  id: string,
  {
    decision,
    resolvedBy,
    resolutionComment,
  }: { decision: "approved" | "rejected"; resolvedBy?: string | null; resolutionComment?: string | null }
): Promise<Appeal> {
  const sb = getServiceClient();
  if (!sb) throw new Error("No DB");

  const now = new Date().toISOString();

  // Is this a native appeal row, or a feedback-form ticket id?
  const { data: existing } = await sb
    .from(APPEALS_TABLE)
    .select("id")
    .eq("id", id)
    .maybeSingle();

  let data: any;
  if (existing) {
    const { data: upd, error } = await sb
      .from(APPEALS_TABLE)
      .update({
        status: decision,
        resolved_by: resolvedBy ?? null,
        resolution_comment: resolutionComment ?? null,
        resolved_at: now,
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    data = upd;
  } else {
    // Feedback-form ticket → backfill a kk_problem_appeals row (deduped by
    // source_id) carrying the decision, so the status persists and the original
    // ticket id stays traceable.
    const { data: ticket, error: te } = await sb
      .from(FEEDBACK_TABLE)
      .select("id, problem_id, accountant_id, accountant_name, situation_comment, solution_comment")
      .eq("id", id)
      .maybeSingle();
    if (te) throw te;
    if (!ticket) throw new Error(`Appeal ${id} not found`);
    const { data: ins, error: ie } = await sb
      .from(APPEALS_TABLE)
      .upsert(
        {
          problem_id: (ticket as any).problem_id,
          accountant_id: (ticket as any).accountant_id ?? null,
          accountant_name: (ticket as any).accountant_name ?? null,
          comment: feedbackComment((ticket as any).situation_comment, (ticket as any).solution_comment),
          status: decision,
          resolved_by: resolvedBy ?? null,
          resolution_comment: resolutionComment ?? null,
          resolved_at: now,
          source: FEEDBACK_SOURCE,
          source_id: (ticket as any).id,
        },
        { onConflict: "source_id" }
      )
      .select()
      .single();
    if (ie) throw ie;
    data = ins;
  }

  const problemId = (data as any).problem_id;
  if (decision === "approved") {
    const { error: pe } = await sb
      .from(PROBLEMS_TABLE)
      .update({ status: "appeal_approved", verdict: "not_problematic", verdict_at: now })
      .eq("problem_id", problemId);
    if (pe) throw pe;
  } else {
    const { error: pe } = await sb
      .from(PROBLEMS_TABLE)
      .update({ status: "appeal_rejected" })
      .eq("problem_id", problemId);
    if (pe) throw pe;
  }
  return data as Appeal;
}

export interface WorkReportFilters {
  from?: string;
  to?: string;
  accountant?: string;
}

/** Assemble Margarita's workload report from her review data + the appeals. */
export async function getWorkReport(filters: WorkReportFilters = {}): Promise<WorkReport> {
  const [evaluations, violations] = await Promise.all([
    listEvaluations({ from: filters.from, to: filters.to, accountant: filters.accountant }),
    listViolations({ from: filters.from, to: filters.to, accountant: filters.accountant }),
  ]);

  const sb = getServiceClient();
  let issues: any[] = [];
  let appeals: any[] = [];
  if (sb) {
    let iq = sb
      .from(PROBLEMS_TABLE)
      .select("problem_id, accountant_name, detected_at, source")
      .eq("source", MARGARITA_SOURCE)
      .limit(10000);
    if (filters.from) iq = iq.gte("detected_at", filters.from);
    if (filters.to) iq = iq.lte("detected_at", `${filters.to}T23:59:59Z`);
    const { data: idata, error: ie } = await iq;
    if (ie) throw ie;
    issues = idata ?? [];

    const all = await listAppeals();
    appeals = all.filter((a) => {
      // Feedback-form appeals always count; native appeals are scoped to
      // Margarita's own review issues (as before).
      if (
        a.source !== FEEDBACK_SOURCE &&
        a.problem_source &&
        a.problem_source !== MARGARITA_SOURCE
      )
        return false;
      const d = a.created_at?.slice(0, 10);
      if (filters.from && d < filters.from) return false;
      if (filters.to && d > filters.to) return false;
      return true;
    });
  }

  return buildWorkReport({ evaluations, violations, issues, appeals });
}
