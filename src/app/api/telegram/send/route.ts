import { NextResponse } from "next/server";
import { sendDocumentToTelegram, sendToTelegram } from "@/lib/telegram";
import { assemblePdfReport } from "@/lib/report-data";
import { buildReportPdf } from "@/lib/report-pdf";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/telegram/send
 * Body: { text, pdf?: { from?: "YYYY-MM-DD", to?: "YYYY-MM-DD" } }
 *
 * Sends the message; when `pdf` is present, also builds the analytics PDF for
 * that window and sends it as a document right after (Telegram captions are
 * capped at 1024 chars, so the long text goes as a normal message first).
 */
export async function POST(req: Request) {
  let text = "";
  let pdf: { from?: string; to?: string } | null = null;
  try {
    const body = await req.json();
    text = String(body.text ?? "");
    if (body.pdf && typeof body.pdf === "object") {
      pdf = {
        from: typeof body.pdf.from === "string" ? body.pdf.from : undefined,
        to: typeof body.pdf.to === "string" ? body.pdf.to : undefined,
      };
    }
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

  if (pdf) {
    try {
      const { report, resolved, roster } = await assemblePdfReport(pdf.from, pdf.to);
      const bytes = await buildReportPdf(report, { roster });
      const docResult = await sendDocumentToTelegram(
        `report-${resolved.from}_${resolved.to}.pdf`,
        bytes,
        "📎 Таблица мониторинга за период"
      );
      if (!docResult.ok) {
        // The text already went out — report the attachment failure without
        // failing the whole send.
        return NextResponse.json({ ok: true, pdf_error: docResult.error });
      }
    } catch (e) {
      return NextResponse.json({
        ok: true,
        pdf_error: e instanceof Error ? e.message : "Не удалось сформировать PDF",
      });
    }
  }

  return NextResponse.json({ ok: true });
}
