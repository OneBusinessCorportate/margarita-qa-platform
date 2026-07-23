// Raw Telegram Bot API senders. NO "server-only" guard on purpose: both the
// Next server routes (through telegram.ts, which keeps the guard) AND the
// standalone daily cron script (scripts/send-margarita-report.ts, which runs
// outside Next) import these, so the send logic is defined exactly ONCE.
//
// Do NOT import this file from a client component — go through telegram.ts there.

export interface TelegramResult {
  ok: boolean;
  error?: string;
}

/** Send a plain-text message to a chat. Plain text — no parse_mode, so nothing
 * in the body needs escaping. Returns a friendly result rather than throwing. */
export async function postTelegramMessage(
  token: string,
  chatId: string,
  text: string
): Promise<TelegramResult> {
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

/** Send a document to a chat by URL — Telegram fetches the file itself, so the
 * caller does not need to download it first. Used to forward the accountant's
 * attached monthly document (salary ведомость / tax report) to the client. */
export async function postTelegramDocumentByUrl(
  token: string,
  chatId: string,
  fileUrl: string,
  caption?: string
): Promise<TelegramResult> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        document: fileUrl,
        ...(caption ? { caption: caption.slice(0, 1024) } : {}),
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

/** Send a document (e.g. a PDF) to a chat with an optional short caption. */
export async function postTelegramDocument(
  token: string,
  chatId: string,
  filename: string,
  data: Buffer,
  caption?: string
): Promise<TelegramResult> {
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
