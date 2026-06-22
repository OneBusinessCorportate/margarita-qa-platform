import { NextResponse } from "next/server";
import { createReportSnapshot, listReportSnapshots } from "@/lib/repo";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await listReportSnapshots());
}

// Save the current Отчёт (for the given filters) into history.
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const str = (v: unknown) =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  const filters = {
    from: str(body.from),
    to: str(body.to),
    accountant: str(body.accountant),
    client: str(body.client),
  };
  const session = await getSession();
  const snap = await createReportSnapshot(filters, session?.email ?? null);
  return NextResponse.json(snap, { status: 201 });
}
