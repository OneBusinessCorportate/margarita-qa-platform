import { NextResponse } from "next/server";
import { updateChatManager } from "@/lib/repo";

export const dynamic = "force-dynamic";

// п.6 — назначить/сменить ответственного менеджера по чату (mqa_chats.manager).
export async function PATCH(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { agr_no, manager } = body ?? {};
  if (typeof agr_no !== "string" || !agr_no) {
    return NextResponse.json({ error: "agr_no required" }, { status: 400 });
  }
  try {
    await updateChatManager(agr_no, typeof manager === "string" ? manager : null);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Update failed" }, { status: 500 });
  }
}
