import { NextResponse } from "next/server";
import { createTask, listTasks } from "@/lib/repo";
import type { NewTaskInput } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const chat = searchParams.get("chat") ?? undefined;
  const tasks = await listTasks(chat);
  return NextResponse.json(tasks);
}

export async function POST(req: Request) {
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
  const input: NewTaskInput = {
    chat_agr_no: body.chat_agr_no,
    type: body.type === "monthly" ? "monthly" : "single",
    category: body.category ?? null,
    due_date_original: body.due_date_original ?? null,
    due_date_postponed: body.due_date_postponed ?? null,
    description: body.description ?? null,
    priority: body.priority ?? "Medium",
    completed_at: body.completed_at ?? null,
    result: body.result ?? null,
    task_status: body.task_status ?? "-",
    accountant: body.accountant ?? null,
    checking_date: body.checking_date ?? undefined,
  };
  const created = await createTask(input);
  return NextResponse.json(created, { status: 201 });
}
