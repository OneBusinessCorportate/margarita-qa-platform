import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { recordUnansweredLabel } from "@/lib/repo";

export const dynamic = "force-dynamic";

/**
 * Record Margarita's confirmation for a flagged chat.
 *   ✔ "ждёт ответа"     → { agr_no, unanswered: true }
 *   ✘ "ответа не нужно"  → { agr_no, unanswered: false }
 * The label is stored for learning and the consumed mqa_chats.unanswered signal
 * is set to her decision.
 */
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (
    !body ||
    typeof body.agr_no !== "string" ||
    typeof body.unanswered !== "boolean"
  ) {
    return NextResponse.json(
      { error: "agr_no (string) and unanswered (boolean) are required" },
      { status: 400 }
    );
  }

  const session = await getSession();
  await recordUnansweredLabel(body.agr_no, body.unanswered, session?.email ?? null);
  return NextResponse.json({ ok: true });
}
