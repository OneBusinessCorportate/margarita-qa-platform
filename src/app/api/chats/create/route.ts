import { NextResponse } from "next/server";
import { addActiveInclusion, createChatByNumber } from "@/lib/repo";

export const dynamic = "force-dynamic";

// п.3 — создать (или переиспользовать) чат по № договора и, если передана дата,
// сразу подтянуть его в список «Активные за день». Для чатов, которых нет в
// «Основные данные», но которые есть в «КК Сопровождения» / «Налоговый кабинет»,
// чтобы поиск больше не упирался в «Ничего не найдено».
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const agr_no = typeof body.agr_no === "string" ? body.agr_no.trim() : "";
  if (!agr_no) {
    return NextResponse.json({ error: "Укажите № договора" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name : null;
  const link = typeof body.link === "string" ? body.link : null;

  try {
    const chat = await createChatByNumber(agr_no, name, link);
    const date = typeof body.date === "string" ? body.date.slice(0, 10) : "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      await addActiveInclusion(chat.agr_no, date);
    }
    return NextResponse.json(chat, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Create failed" }, { status: 500 });
  }
}
