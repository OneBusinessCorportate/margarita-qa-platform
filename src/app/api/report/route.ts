import { NextResponse } from "next/server";
import { getReport } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const report = await getReport({
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    accountant: searchParams.get("accountant") ?? undefined,
    client: searchParams.get("client") ?? undefined,
  });
  return NextResponse.json(report);
}
