import { NextResponse } from "next/server";

// Render health check. Always 200 when the process is up.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok", time: new Date().toISOString() });
}
