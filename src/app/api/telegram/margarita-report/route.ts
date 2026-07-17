import { NextResponse } from "next/server";
import { sendToTelegram } from "@/lib/telegram";
import {
  assembleMargaritaReport,
  pickMargaritaChatId,
  MARGARITA_QA_CHAT_ENV,
  type MargaritaWindowOptions,
} from "@/lib/margarita-report";
import { storageGuard, dbErrorResponse } from "@/lib/api-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Read the window overrides from the query string (?date | ?from&?to&?accountant). */
function windowFromSearch(url: string): MargaritaWindowOptions {
  const q = new URL(url).searchParams;
  return {
    date: q.get("date") ?? undefined,
    from: q.get("from") ?? undefined,
    to: q.get("to") ?? undefined,
    accountant: q.get("accountant") ?? undefined,
  };
}

/**
 * GET /api/telegram/margarita-report?date=YYYY-MM-DD (or ?from&to)
 *
 * PREVIEW only — composes the «Апелляции и QA Маргариты» daily report and
 * returns it as JSON WITHOUT sending, so the message can be checked before it
 * goes out. Reports which chat it WOULD target (dedicated vs shared).
 */
export async function GET(req: Request) {
  try {
    const { window, message, report } = await assembleMargaritaReport(
      windowFromSearch(req.url)
    );
    const chatId = pickMargaritaChatId();
    return NextResponse.json({
      ok: true,
      window,
      message,
      report,
      chatConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && chatId),
      chatTarget: process.env[MARGARITA_QA_CHAT_ENV]
        ? "dedicated (MARGARITA_QA_TELEGRAM_CHAT_ID)"
        : chatId
          ? "shared (TELEGRAM_CHAT_ID)"
          : "none",
    });
  } catch (e) {
    return dbErrorResponse(e);
  }
}

/**
 * POST /api/telegram/margarita-report
 * Body (optional): { date?, from?, to?, accountant? }
 *
 * Builds the daily report and SENDS it to the Margarita chat
 * (MARGARITA_QA_TELEGRAM_CHAT_ID if set, else TELEGRAM_CHAT_ID). This is the
 * "run it manually to verify" path; the automatic daily send is the cron script
 * scripts/send-margarita-report.ts, which shares the same assembler.
 */
export async function POST(req: Request) {
  // Never send an all-zero report because storage isn't configured in prod.
  const guard = storageGuard();
  if (guard) return guard;

  let opts: MargaritaWindowOptions = {};
  try {
    const body = await req.json().catch(() => ({}));
    opts = {
      date: typeof body.date === "string" ? body.date : undefined,
      from: typeof body.from === "string" ? body.from : undefined,
      to: typeof body.to === "string" ? body.to : undefined,
      accountant: typeof body.accountant === "string" ? body.accountant : undefined,
    };
  } catch {
    // No/blank body → default window (today, Yerevan).
  }

  const chatId = pickMargaritaChatId();
  if (!process.env.TELEGRAM_BOT_TOKEN || !chatId) {
    return NextResponse.json(
      {
        error:
          "Telegram бот не настроен: задайте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID (или MARGARITA_QA_TELEGRAM_CHAT_ID).",
      },
      { status: 503 }
    );
  }

  let message: string;
  let window;
  try {
    ({ message, window } = await assembleMargaritaReport(opts));
  } catch (e) {
    return dbErrorResponse(e);
  }

  const result = await sendToTelegram(message, chatId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true, window });
}
