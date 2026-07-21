import { NextResponse } from "next/server";
import { sendToTelegram } from "@/lib/telegram";
import { pickMargaritaChatId } from "@/lib/margarita-report";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/telegram/send
 * Body: {
 *   text,
 *   chat?: "default" | "margarita",   // "margarita" → MARGARITA_QA_TELEGRAM_CHAT_ID (or TELEGRAM_CHAT_ID)
 * }
 *
 * Sends the report/message as plain text. The PDF attachment path was removed —
 * the отчёт is no longer a PDF: Margarita edits + approves it on the platform and
 * the approved version is shown to accountants in kk-accountants-feedback-form
 * (see mqa_published_reports / kk_published_reports).
 */
export async function POST(req: Request) {
  let text = "";
  let chat: "default" | "margarita" = "default";
  try {
    const body = await req.json();
    text = String(body.text ?? "");
    if (body.chat === "margarita") chat = "margarita";
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!text.trim()) {
    return NextResponse.json({ error: "Пустое сообщение" }, { status: 400 });
  }
  // The Margarita QA/appeals report may go to its own chat when
  // MARGARITA_QA_TELEGRAM_CHAT_ID is set; otherwise it shares TELEGRAM_CHAT_ID.
  const chatOverride = chat === "margarita" ? pickMargaritaChatId() : undefined;
  const result = await sendToTelegram(text, chatOverride);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
