import { NextResponse } from "next/server";
import { listViolationAppealViews } from "@/lib/repo";
import { dbErrorResponse } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

// GET — all violation-appeals (enriched with their violation) for Margarita.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  try {
    const rows = await listViolationAppealViews({
      status: searchParams.get("status") ?? undefined,
      accountant: searchParams.get("accountant") ?? undefined,
    });
    return NextResponse.json(rows);
  } catch (e) {
    return dbErrorResponse(e);
  }
}
