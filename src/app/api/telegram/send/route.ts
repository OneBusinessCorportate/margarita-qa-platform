import { NextResponse } from "next/server";
import { sendToTelegram } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let text = "";
  try {
    const body = await req.json();
    text = String(body.text ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!text.trim()) {
    return NextResponse.json({ error: "Пустое сообщение" }, { status: 400 });
  }
  const result = await sendToTelegram(text);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
