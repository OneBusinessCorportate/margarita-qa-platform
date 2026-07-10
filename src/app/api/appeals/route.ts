import { NextResponse } from "next/server";
import { listAppeals } from "@/lib/appeals-data";
import { dbErrorResponse } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  try {
    const rows = await listAppeals({
      status: searchParams.get("status") ?? undefined,
      accountant: searchParams.get("accountant") ?? undefined,
    });
    return NextResponse.json(rows);
  } catch (e) {
    return dbErrorResponse(e);
  }
}
