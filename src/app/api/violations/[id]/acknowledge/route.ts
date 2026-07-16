import { NextResponse } from "next/server";
import { acknowledgeViolation } from "@/lib/repo";
import { storageGuard, dbErrorResponse } from "@/lib/api-guard";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// POST — accountant «Ознакомлен». Idempotent: repeated calls never duplicate.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const blocked = storageGuard();
  if (blocked) return blocked;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* body optional */
  }
  const session = await getSession().catch(() => null);
  const by =
    (typeof body?.accountant === "string" && body.accountant.trim()) ||
    session?.email ||
    null;
  try {
    const updated = await acknowledgeViolation(params.id, by);
    return NextResponse.json(updated);
  } catch (e) {
    return dbErrorResponse(e);
  }
}
