// Server-only Telegram sender. Activates when TELEGRAM_BOT_TOKEN +
// TELEGRAM_CHAT_ID are set; otherwise returns a friendly "not configured".
// The raw fetch senders live in telegram-core.ts (no server-only guard) so the
// daily cron script can reuse the SAME logic without pulling in "server-only".
import "server-only";
import { postTelegramMessage, postTelegramDocument } from "./telegram-core";

export async function sendToTelegram(
  text: string,
  chatIdOverride?: string
): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = chatIdOverride || process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { ok: false, error: "Telegram бот не настроен (нет токена / chat id)" };
  }
  return postTelegramMessage(token, chatId, text);
}

/**
 * Send a document (e.g. the PDF analytics report) to the report chat.
 * Telegram caps captions at 1024 chars, so long report text goes through
 * sendToTelegram first and the document follows with a short caption.
 */
export async function sendDocumentToTelegram(
  filename: string,
  data: Buffer,
  caption?: string,
  chatIdOverride?: string
): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = chatIdOverride || process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { ok: false, error: "Telegram бот не настроен (нет токена / chat id)" };
  }
  return postTelegramDocument(token, chatId, filename, data, caption);
}
