import { NextResponse } from "next/server";
import { deleteEvaluation, updateEvaluation } from "@/lib/repo";
import { dbErrorResponse } from "@/lib/api-guard";
import { getSession } from "@/lib/session";
import { validConfidence } from "@/lib/confidence";
import type { NewEvaluationInput } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!body || typeof body.chat_agr_no !== "string") {
    return NextResponse.json(
      { error: "chat_agr_no is required" },
      { status: 400 }
    );
  }
  const checking_date =
    typeof body.checking_date === "string"
      ? body.checking_date
      : new Date().toISOString().slice(0, 10);
  const input: NewEvaluationInput = {
    chat_agr_no: body.chat_agr_no,
    period:
      typeof body.period === "string" && body.period
        ? body.period
        : checking_date.slice(0, 7).replace("-", ""),
    checking_date,
    role:
      body.role === "manager" || body.role === "lawyer"
        ? body.role
        : "accountant",
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
  try {
    const session = await getSession();
    const updated = await updateEvaluation(params.id, input, session?.email ?? null);
    return NextResponse.json(updated);
  } catch (e) {
    return dbErrorResponse(e);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    await deleteEvaluation(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return dbErrorResponse(e);
  }
}
