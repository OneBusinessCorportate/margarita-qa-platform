import { NextResponse } from "next/server";
import { deleteChat } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: { agr_no: string } }
) {
  const { agr_no } = params;
  if (!agr_no) {
    return NextResponse.json({ error: "agr_no required" }, { status: 400 });
  }
  try {
    await deleteChat(agr_no);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Delete failed" },
      { status: 500 }
    );
  }
}
