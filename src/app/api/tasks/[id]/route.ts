import { NextResponse } from "next/server";
import { updateTask } from "@/lib/repo";
import { getSession } from "@/lib/session";
import { storageGuard, dbErrorResponse } from "@/lib/api-guard";
import type { TaskPatch } from "@/lib/types";

export const dynamic = "force-dynamic";

// PATCH — update a task's status / completion / recurring flag / QA confirmation.
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const blocked = storageGuard();
  if (blocked) return blocked;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const session = await getSession().catch(() => null);
  const patch: TaskPatch = {
    task_status: body.task_status,
    completed_at: body.completed_at,
    result: body.result,
    recurring: typeof body.recurring === "boolean" ? body.recurring : undefined,
    qa_confirmed:
      typeof body.qa_confirmed === "boolean" ? body.qa_confirmed : undefined,
    qa_confirmed_by: session?.email ?? null,
  };
  try {
    const updated = await updateTask(params.id, patch);
    return NextResponse.json(updated);
  } catch (e) {
    return dbErrorResponse(e);
  }
}
