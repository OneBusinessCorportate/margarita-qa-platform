import { NextResponse } from "next/server";
import {
  addActiveInclusion,
  listActiveInclusions,
  removeActiveInclusion,
} from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await listActiveInclusions());
}

function parse(body: any): { agr_no: string; date: string } | null {
  if (!body || typeof body.agr_no !== "string" || typeof body.date !== "string")
    return null;
  const date = body.date.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!body.agr_no.trim()) return null;
  return { agr_no: body.agr_no, date };
}

// Manually add a chat to "Активные за день" for the given day.
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const input = parse(body);
  if (!input)
    return NextResponse.json(
      { error: "agr_no and date (YYYY-MM-DD) are required" },
      { status: 400 }
    );
  await addActiveInclusion(input.agr_no, input.date);
  return NextResponse.json({ ok: true }, { status: 201 });
}

// Remove a manually-added chat for the given day.
export async function DELETE(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const input = parse(body);
  if (!input)
    return NextResponse.json(
      { error: "agr_no and date (YYYY-MM-DD) are required" },
      { status: 400 }
    );
  await removeActiveInclusion(input.agr_no, input.date);
  return NextResponse.json({ ok: true });
}
