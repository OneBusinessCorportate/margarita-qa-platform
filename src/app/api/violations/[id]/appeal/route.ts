import { NextResponse } from "next/server";
import { createViolationAppeal } from "@/lib/repo";
import { storageGuard, dbErrorResponse } from "@/lib/api-guard";
import { validateAppealText } from "@/lib/violation-workflow";

export const dynamic = "force-dynamic";

// POST — accountant «Подать апелляцию». Server validates: non-empty text,
// ownership, one pending appeal per violation, and current violation status.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const blocked = storageGuard();
  if (blocked) return blocked;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  let text: string;
  try {
    text = validateAppealText(body?.appeal_text ?? body?.text);
  } catch (e) {
    return dbErrorResponse(e);
  }

  const accountant =
    typeof body?.accountant === "string" && body.accountant.trim()
      ? body.accountant.trim()
      : null;
  // Ownership: when the actor is a known accountant, enforce it; when Margarita
  // (a QA session email, not an accountant name) files on their behalf, skip.
  const actor = accountant;
  try {
    const created = await createViolationAppeal(
      { violation_id: params.id, accountant, appeal_text: text },
      actor
    );
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    return dbErrorResponse(e);
  }
}
