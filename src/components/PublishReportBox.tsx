"use client";

import { useState } from "react";

/**
 * Editable + approvable daily report. Replaces the old auto-generated PDF: the
 * generated report text is shown in an editable textarea; Margarita corrects any
 * wording/number, then «Опубликовать для бухгалтеров» stores the approved text
 * (POST /api/published-report). Accountants see ONLY this approved version, in
 * kk-accountants-feedback-form (via the read-only kk_published_reports view).
 */
export default function PublishReportBox({
  initialText,
  title = "Ежедневный отчёт бухгалтерии",
  reportDate,
  periodLabel,
}: {
  initialText: string;
  title?: string;
  reportDate?: string | null;
  periodLabel?: string | null;
}) {
  const [text, setText] = useState(initialText);
  const [state, setState] = useState<"idle" | "saving" | "ok" | "err">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  // The generated report changes when filters/data change; let the editor pull
  // the fresh generated text back in if the user hasn't diverged too far.
  const dirty = text !== initialText;

  async function publish() {
    setState("saving");
    setMsg(null);
    try {
      const res = await fetch("/api/published-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          body: text,
          report_date: reportDate ?? null,
          period_label: periodLabel ?? null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setState("err");
        setMsg(d.error || `Ошибка ${res.status}`);
        return;
      }
      setState("ok");
      setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("err");
      setMsg("Сетевая ошибка");
    }
  }

  return (
    <div className="space-y-2">
      <textarea
        className="input w-full font-mono text-xs leading-relaxed"
        rows={18}
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" onClick={publish} disabled={state === "saving"}>
          {state === "saving"
            ? "Публикация…"
            : state === "ok"
              ? "Опубликовано ✓"
              : "✅ Опубликовать для бухгалтеров"}
        </button>
        {dirty && (
          <button
            className="btn-secondary"
            onClick={() => setText(initialText)}
            disabled={state === "saving"}
            title="Вернуть автоматически сгенерированный текст"
          >
            Сбросить к авто-версии
          </button>
        )}
        {state === "err" && msg && <span className="text-xs text-red-600">{msg}</span>}
        <span className="text-xs text-gray-400">
          Бухгалтеры видят только опубликованную (одобренную) версию.
        </span>
      </div>
    </div>
  );
}
