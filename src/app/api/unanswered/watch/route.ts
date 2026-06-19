import { NextResponse } from "next/server";
import { setUnansweredWatched } from "@/lib/repo";

export const dynamic = "force-dynamic";

/**
 * Toggle «на контроле» for a chat — the digital version of Margarita leaving a
 * chat unread and marking it to re-check later. Body: { agr_no, watched }.
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
    typeof body.watched !== "boolean"
  ) {
    return NextResponse.json(
      { error: "agr_no (string) and watched (boolean) are required" },
      { status: 400 }
    );
  }
  await setUnansweredWatched(body.agr_no, body.watched);
  return NextResponse.json({ ok: true });
}
