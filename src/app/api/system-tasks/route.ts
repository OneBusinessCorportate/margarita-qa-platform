import { NextResponse } from "next/server";
import {
  createAccountantSystemTask,
  listAccountantSystemTasks,
} from "@/lib/repo";
import { getSession } from "@/lib/session";
import { storageGuard, dbErrorResponse } from "@/lib/api-guard";
import type { NewSystemTaskInput } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET — list системных задач бухгалтеров (optional ?accountant / ?status / ?ticket).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  try {
    const rows = await listAccountantSystemTasks({
      accountant: searchParams.get("accountant") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      ticketId: searchParams.get("ticket") ?? undefined,
    });
    return NextResponse.json(rows);
  } catch (e) {
    return dbErrorResponse(e);
  }
}

// POST — create a system task (title required). created_by is taken from session.
export async function POST(req: Request) {
  const blocked = storageGuard();
  if (blocked) return blocked;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const session = await getSession().catch(() => null);
  const input: NewSystemTaskInput = {
    ticket_id: body.ticket_id ?? null,
    accountant_name: body.accountant_name ?? null,
    client_name: body.client_name ?? null,
    chat_id: body.chat_id ?? null,
    title: body.title,
    description: body.description ?? null,
    priority: body.priority,
    status: body.status,
    due_date_original: body.due_date_original ?? null,
    due_date_postponed: body.due_date_postponed ?? null,
    created_by: session?.email ?? null,
  };
  try {
    const created = await createAccountantSystemTask(input);
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    return dbErrorResponse(e);
  }
}
