import { NextResponse } from "next/server";
import { updateChatAccountant } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { agr_no, accountant } = body ?? {};
  if (typeof agr_no !== "string" || !agr_no) {
    return NextResponse.json({ error: "agr_no required" }, { status: 400 });
  }
  try {
    await updateChatAccountant(agr_no, accountant ?? null);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Update failed" }, { status: 500 });
  }
}
