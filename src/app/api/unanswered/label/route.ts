import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { recordUnansweredLabel, type HumanStatus } from "@/lib/repo";

export const dynamic = "force-dynamic";

const STATUSES: HumanStatus[] = ["waiting", "warned", "answered"];

/**
 * Record Margarita's per-row status (her «КК Сопровождение» dropdown habit):
 *   { agr_no, status: "waiting" | "warned" | "answered" }
 * Back-compat: { agr_no, unanswered: boolean } → true=waiting, false=answered.
 */
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!body || typeof body.agr_no !== "string") {
    return NextResponse.json({ error: "agr_no is required" }, { status: 400 });
  }

  let status: HumanStatus | null = null;
  if (typeof body.status === "string" && STATUSES.includes(body.status)) {
    status = body.status;
  } else if (typeof body.unanswered === "boolean") {
    status = body.unanswered ? "waiting" : "answered";
  }
  if (!status) {
    return NextResponse.json(
      { error: "status (waiting|warned|answered) or unanswered (boolean) required" },
      { status: 400 }
    );
  }

  const session = await getSession();
  await recordUnansweredLabel(body.agr_no, status, session?.email ?? null);
  return NextResponse.json({ ok: true });
}
