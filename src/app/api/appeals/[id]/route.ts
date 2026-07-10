import { NextResponse } from "next/server";
import { updateAppeal } from "@/lib/appeals-data";
import { storageGuard, dbErrorResponse } from "@/lib/api-guard";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const blocked = storageGuard();
  if (blocked) return blocked;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const decision = body.decision;
  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json(
      { error: "decision must be 'approved' or 'rejected'" },
      { status: 400 }
    );
  }

  const session = await getSession().catch(() => null);
  try {
    const updated = await updateAppeal(params.id, {
      decision,
      resolvedBy: session?.email ?? null,
      resolutionComment:
        typeof body.resolution_comment === "string" && body.resolution_comment.trim()
          ? body.resolution_comment.trim()
          : null,
    });
    return NextResponse.json(updated);
  } catch (e) {
    return dbErrorResponse(e);
  }
}
