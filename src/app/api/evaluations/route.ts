import { NextResponse } from "next/server";
import { createEvaluation, listEvaluations } from "@/lib/repo";
import { storageGuard, dbErrorResponse } from "@/lib/api-guard";
import { getSession } from "@/lib/session";
import { validConfidence } from "@/lib/confidence";
import type { NewEvaluationInput } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const evals = await listEvaluations({
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    accountant: searchParams.get("accountant") ?? undefined,
    client: searchParams.get("client") ?? undefined,
  });
  return NextResponse.json(evals);
}

function parseInput(body: any): NewEvaluationInput | null {
  if (!body || typeof body.chat_agr_no !== "string") return null;
  const checking_date =
    typeof body.checking_date === "string"
      ? body.checking_date
      : new Date().toISOString().slice(0, 10);
  const period =
    typeof body.period === "string" && body.period
      ? body.period
      : checking_date.slice(0, 7).replace("-", "");
  const role: "accountant" | "manager" | "lawyer" =
    body.role === "manager" || body.role === "lawyer" ? body.role : "accountant";
  return {
    chat_agr_no: body.chat_agr_no,
    period,
    checking_date,
    role,
    accountant: body.accountant ?? null,
    scores: {
      scheme: body.scores?.scheme,
      criteria: body.scores?.criteria,
      greeting: body.scores?.greeting,
      monthly: body.scores?.monthly,
      registration: body.scores?.registration,
      kpi: body.scores?.kpi,
      ai: body.scores?.ai,
    },
    comment: body.comment ?? null,
    total_override:
      typeof body.total_override === "number" ? body.total_override : null,
    ai_confidence:
      validConfidence(body.ai_confidence) ??
      validConfidence(body.scores?.ai?.confidence),
  };
}

export async function POST(req: Request) {
  const blocked = storageGuard();
  if (blocked) return blocked;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const input = parseInput(body);
  if (!input) {
    return NextResponse.json(
      { error: "chat_agr_no is required" },
      { status: 400 }
    );
  }
  try {
    const session = await getSession();
    const created = await createEvaluation(input, session?.email ?? null);
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    return dbErrorResponse(e);
  }
}
