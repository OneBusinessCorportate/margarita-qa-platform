import { NextResponse } from "next/server";
import { createScoreOverride, listScoreOverrides } from "@/lib/repo";
import { storageGuard, dbErrorResponse } from "@/lib/api-guard";
import { getSession } from "@/lib/session";
import type { NewScoreOverrideInput } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/score-overrides?chat=B-1411 — manual score overrides + history.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const overrides = await listScoreOverrides(searchParams.get("chat") ?? undefined);
  return NextResponse.json(overrides);
}

function parseInput(body: any): NewScoreOverrideInput | null {
  if (!body || typeof body.chat_agr_no !== "string") return null;
  if (typeof body.score_date !== "string" || !body.score_date) return null;
  const score = Number(body.new_score);
  if (!Number.isFinite(score) || score < 0 || score > 100) return null;
  // A justification is REQUIRED for every manual score edit (audit trail).
  const comment = typeof body.comment === "string" ? body.comment.trim() : "";
  if (!comment) return null;
  return {
    chat_agr_no: body.chat_agr_no,
    score_date: body.score_date,
    new_score: score,
    comment,
    old_score:
      typeof body.old_score === "number" ? body.old_score : null,
    client_name: typeof body.client_name === "string" ? body.client_name : null,
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
      { error: "chat_agr_no, score_date, new_score (0..100) и comment обязательны" },
      { status: 400 }
    );
  }
  const session = await getSession().catch(() => null);
  input.changed_by = session?.email ?? null;
  try {
    const created = await createScoreOverride(input);
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    return dbErrorResponse(e);
  }
}
