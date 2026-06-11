import { NextResponse } from "next/server";
import { updateEvaluation } from "@/lib/repo";
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
    accountant: body.accountant ?? null,
    scores: { criteria: body.scores?.criteria, monthly: body.scores?.monthly },
    comment: body.comment ?? null,
    total_override:
      typeof body.total_override === "number" ? body.total_override : null,
  };
  try {
    const updated = await updateEvaluation(params.id, input);
    return NextResponse.json(updated);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Update failed" },
      { status: 404 }
    );
  }
}
