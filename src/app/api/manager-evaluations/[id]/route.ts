import { NextResponse } from "next/server";
import { updateManagerEvaluation } from "@/lib/repo";
import type { NewManagerEvaluationInput } from "@/lib/types";

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
  if (!body || typeof body.manager !== "string" || !body.manager.trim()) {
    return NextResponse.json({ error: "Укажите менеджера" }, { status: 400 });
  }
  const week_start =
    typeof body.week_start === "string" && body.week_start
      ? body.week_start
      : new Date().toISOString().slice(0, 10);
  const registration =
    body.scores?.registration && typeof body.scores.registration === "object"
      ? body.scores.registration
      : {};
  const input: NewManagerEvaluationInput = {
    manager: body.manager.trim(),
    week_start,
    period: typeof body.period === "string" ? body.period : undefined,
    scores: { registration },
    comment: body.comment ?? null,
    total_override:
      typeof body.total_override === "number" ? body.total_override : null,
  };
  try {
    const updated = await updateManagerEvaluation(params.id, input);
    return NextResponse.json(updated);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Update failed" },
      { status: 404 }
    );
  }
}
