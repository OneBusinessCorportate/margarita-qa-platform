import { NextResponse } from "next/server";
import { resolveViolationAppeal } from "@/lib/repo";
import { storageGuard, dbErrorResponse } from "@/lib/api-guard";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// PATCH — Margarita accepts («approved») or rejects («rejected») an appeal.
// Atomic + idempotent: resolving an already-resolved appeal returns 409.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const blocked = storageGuard();
  if (blocked) return blocked;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const decision = body?.decision;
  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json(
      { error: "decision must be 'approved' or 'rejected'" },
      { status: 400 }
    );
  }

  const session = await getSession().catch(() => null);
  try {
    const updated = await resolveViolationAppeal(params.id, {
      decision,
      resolvedBy: session?.email ?? null,
      decisionComment:
        typeof body?.decision_comment === "string" ? body.decision_comment : null,
    });
    return NextResponse.json(updated);
  } catch (e) {
    return dbErrorResponse(e);
  }
}
