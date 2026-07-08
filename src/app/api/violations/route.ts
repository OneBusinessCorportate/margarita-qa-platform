import { NextResponse } from "next/server";
import { createViolation, listViolations } from "@/lib/repo";
import { storageGuard, dbErrorResponse } from "@/lib/api-guard";
import type { NewViolationInput } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rows = await listViolations({
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    accountant: searchParams.get("accountant") ?? undefined,
  });
  return NextResponse.json(rows);
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
  const vdate =
    typeof body.vdate === "string" && body.vdate
      ? body.vdate
      : new Date().toISOString().slice(0, 10);
  const input: NewViolationInput = {
    vdate,
    accountant: body.accountant ?? null,
    chat_agr_no: body.chat_agr_no ?? null,
    client: body.client ?? null,
    severity: body.severity ?? null,
    violation_type: body.violation_type ?? null,
    gross: body.gross ?? null,
    sanction:
      body.sanction === "" || body.sanction === null || body.sanction === undefined
        ? null
        : Number(body.sanction),
    note: body.note ?? null,
  };
  try {
    const created = await createViolation(input);
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    return dbErrorResponse(e);
  }
}
