import { NextResponse } from "next/server";
import { addActiveInclusion, createChatFromLink } from "@/lib/repo";
import { isTelegramLink } from "@/lib/chat-list";

export const dynamic = "force-dynamic";

// Create (or reuse) a chat from a pasted Telegram link and, when a date is
// given, pull it into that day's "Активные за день" list — for chats missing
// from the system entirely (items 5, 6).
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const link = typeof body.link === "string" ? body.link.trim() : "";
  if (!isTelegramLink(link))
    return NextResponse.json(
      { error: "Вставьте ссылку Telegram (web.telegram.org / t.me)" },
      { status: 400 }
    );

  const chat = await createChatFromLink(link, body.name ?? null);

  const date =
    typeof body.date === "string" ? body.date.slice(0, 10) : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    await addActiveInclusion(chat.agr_no, date);
  }

  return NextResponse.json(chat, { status: 201 });
}
