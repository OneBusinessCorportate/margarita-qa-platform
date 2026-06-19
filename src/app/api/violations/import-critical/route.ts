import { NextResponse } from "next/server";
import { importCriticalChatsAsViolations } from "@/lib/repo";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// POST { date } — log every Критично chat from that day's report into Нарушения.
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const date =
    typeof body.date === "string" && body.date
      ? body.date
      : new Date().toISOString().slice(0, 10);
  const session = await getSession().catch(() => null);
  const result = await importCriticalChatsAsViolations(date, session?.email ?? null);
  return NextResponse.json(result);
}
