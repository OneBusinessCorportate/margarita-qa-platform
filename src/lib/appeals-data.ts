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
const MARGARITA_SOURCE = "margarita_review";

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
  // Joined from kk_problems for display:
  problem_title: string | null;
  problem_source: string | null;
  problem_status: string | null;
  client_name: string | null;
  chat_link: string | null;
}

export interface AppealFilters {
  status?: string;
  accountant?: string;
}

/** All appeals (newest first), each enriched with its disputed issue's details. */
export async function listAppeals(filters: AppealFilters = {}): Promise<Appeal[]> {
  const sb = getServiceClient();
  if (!sb) return [];

  let q = sb
    .from(APPEALS_TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(5000);
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.accountant) q = q.eq("accountant_name", filters.accountant);
  const { data, error } = await q;
  if (error) throw error;
  const appeals = (data ?? []) as any[];

  const ids = [...new Set(appeals.map((a) => a.problem_id))];
  const problems = new Map<string, any>();
  if (ids.length) {
    const { data: probs, error: pe } = await sb
      .from(PROBLEMS_TABLE)
      .select("problem_id, problem_title, source, client_name, chat_link, status")
      .in("problem_id", ids);
    if (pe) throw pe;
    for (const p of probs ?? []) problems.set(p.problem_id, p);
  }

  return appeals.map((a) => {
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
  const { data, error } = await sb
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
      if (a.problem_source && a.problem_source !== MARGARITA_SOURCE) return false;
      const d = a.created_at?.slice(0, 10);
      if (filters.from && d < filters.from) return false;
      if (filters.to && d > filters.to) return false;
      return true;
    });
  }

  return buildWorkReport({ evaluations, violations, issues, appeals });
}
