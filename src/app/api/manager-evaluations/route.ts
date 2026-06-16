import { NextResponse } from "next/server";
import {
  createManagerEvaluation,
  listManagerEvaluations,
} from "@/lib/repo";
import type { NewManagerEvaluationInput } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rows = await listManagerEvaluations({
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    manager: searchParams.get("manager") ?? undefined,
  });
  return NextResponse.json(rows);
}

function parseInput(body: any): NewManagerEvaluationInput | null {
  if (!body || typeof body.manager !== "string" || !body.manager.trim()) {
    return null;
  }
  const week_start =
    typeof body.week_start === "string" && body.week_start
      ? body.week_start
      : new Date().toISOString().slice(0, 10);
  const registration =
    body.scores?.registration && typeof body.scores.registration === "object"
      ? body.scores.registration
      : {};
  return {
    manager: body.manager.trim(),
    week_start,
    period: typeof body.period === "string" ? body.period : undefined,
    scores: { registration },
    comment: body.comment ?? null,
    total_override:
      typeof body.total_override === "number" ? body.total_override : null,
  };
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const input = parseInput(body);
  if (!input) {
    return NextResponse.json({ error: "Укажите менеджера" }, { status: 400 });
  }
  const created = await createManagerEvaluation(input);
  return NextResponse.json(created, { status: 201 });
}
