import { NextResponse } from "next/server";
import { updateAccountantSystemTask } from "@/lib/repo";
import { storageGuard, dbErrorResponse } from "@/lib/api-guard";
import type { SystemTaskPatch } from "@/lib/types";

export const dynamic = "force-dynamic";

// PATCH — update a system task (status / priority / dates / fields).
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
  const patch: SystemTaskPatch = {
    status: body.status,
    priority: body.priority,
    title: body.title,
    description: body.description,
    accountant_name: body.accountant_name,
    client_name: body.client_name,
    chat_id: body.chat_id,
    ticket_id: body.ticket_id,
    due_date_original: body.due_date_original,
    due_date_postponed: body.due_date_postponed,
    completed_at: body.completed_at,
  };
  try {
    const updated = await updateAccountantSystemTask(params.id, patch);
    return NextResponse.json(updated);
  } catch (e) {
    return dbErrorResponse(e);
  }
}
