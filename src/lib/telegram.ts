// Server-only Telegram sender. Activates when TELEGRAM_BOT_TOKEN +
// TELEGRAM_CHAT_ID are set; otherwise returns a friendly "not configured".
import "server-only";

export async function sendToTelegram(
  text: string,
  chatIdOverride?: string
): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = chatIdOverride || process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { ok: false, error: "Telegram бот не настроен (нет токена / chat id)" };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Telegram API ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Сетевая ошибка" };
  }
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
  try {
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append(
      "document",
      new Blob([new Uint8Array(data)], { type: "application/pdf" }),
      filename
    );
    if (caption) form.append("caption", caption.slice(0, 1024));
    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Telegram API ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Сетевая ошибка" };
  }
}
