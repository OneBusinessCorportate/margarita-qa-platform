import { NextResponse } from "next/server";
import { runMailingsDetection } from "@/lib/mailings-run";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/mailings/detect
 * Body (optional): { period?: "YYYYMM" }   defaults to current Yerevan month
 *
 * Manual/scheduled trigger for the mailing scan. The actual work lives in
 * src/lib/mailings-run.ts (shared with the Scoring page's automatic refresh):
 * scans accountant messages for the period, counts keyword signals, classifies
 * keyword-missed messages with Claude, derives the graduated mailing status
 * and upserts into mqa_chat_mailings. Manual-confirmed rows are protected.
 *
 * Also callable as GET for a quick health-check or scheduled trigger.
 */
export async function POST(req: Request) {
  let period: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.period === "string" && /^\d{6}$/.test(body.period)) {
      period = body.period;
    }
  } catch {
    // ignore — default to the current Yerevan month
  }
  return respond(await runMailingsDetection(period));
}

export async function GET() {
  return respond(await runMailingsDetection());
}

function respond(result: Awaited<ReturnType<typeof runMailingsDetection>>) {
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 502 });
  }
  const { status: _status, error: _error, ...body } = result;
  return NextResponse.json(body);
}
