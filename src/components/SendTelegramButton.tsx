"use client";

import { useState } from "react";

export default function SendTelegramButton({
  text,
  configured,
  label = "Отправить в Telegram",
  pdfPeriod,
  chat,
}: {
  text: string;
  configured: boolean;
  label?: string;
  /** When set, the report PDF for this window is attached after the message. */
  pdfPeriod?: { from: string; to: string; period?: "daily" | "weekly" };
  /** "margarita" routes the message to MARGARITA_QA_TELEGRAM_CHAT_ID when set. */
  chat?: "margarita";
}) {
  const [state, setState] = useState<"idle" | "sending" | "ok" | "err">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  async function send() {
    setState("sending");
    setMsg(null);
    try {
      const res = await fetch("/api/telegram/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          ...(chat ? { chat } : {}),
          ...(pdfPeriod ? { pdf: pdfPeriod } : {}),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setState("err");
        setMsg(d.error || "Ошибка отправки");
        return;
      }
      const d = await res.json().catch(() => ({}));
      if (d.pdf_error) {
        setState("err");
        setMsg(`Сообщение ушло, но PDF не отправился: ${d.pdf_error}`);
        return;
      }
      setState("ok");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("err");
      setMsg("Сетевая ошибка");
    }
  }

  if (!configured) {
    return (
      <button
        className="btn-secondary"
        disabled
        title="Задайте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID, чтобы включить отправку"
      >
        Отправить (бот не настроен)
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button className="btn-primary" onClick={send} disabled={state === "sending"}>
        {state === "sending" ? "Отправка…" : state === "ok" ? "Отправлено ✓" : label}
      </button>
      {state === "err" && msg && <span className="text-xs text-red-600">{msg}</span>}
    </span>
  );
}
