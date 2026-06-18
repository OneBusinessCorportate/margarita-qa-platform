"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isTelegramLink, waitingLabel } from "@/lib/chat-list";
import type { UnansweredQueueItem } from "@/lib/repo";

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "высокая",
  medium: "средняя",
  low: "низкая",
};

export default function UnansweredPanel({
  items,
  aiEnabled,
}: {
  items: UnansweredQueueItem[];
  aiEnabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const nowISO = new Date().toISOString();

  async function analyze() {
    setAnalyzing(true);
    setNote(null);
    try {
      const res = await fetch("/api/unanswered/analyze", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Ошибка анализа");
      setNote(
        `Проанализировано: ${data.analyzed}. Ждут ответа: ${data.flagged ?? 0}, закрыто: ${data.cleared ?? 0}.`
      );
      router.refresh();
    } catch (e: any) {
      setNote(e?.message ?? String(e));
    } finally {
      setAnalyzing(false);
    }
  }

  async function label(agr_no: string, unanswered: boolean) {
    setBusy(agr_no);
    try {
      const res = await fetch("/api/unanswered/label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agr_no, unanswered }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? "Ошибка");
      }
      router.refresh();
    } catch (e: any) {
      setNote(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-lg font-semibold text-gray-900">
          Без ответа{" "}
          <span className="text-gray-400 font-normal">({items.length})</span>
        </h1>
        <div className="flex items-center gap-3">
          {note && <span className="text-sm text-gray-500">{note}</span>}
          <button
            onClick={analyze}
            disabled={analyzing || !aiEnabled}
            title={aiEnabled ? "Запустить ИИ-анализ новых чатов" : "ANTHROPIC_API_KEY не настроен"}
            className="btn-primary disabled:opacity-50"
          >
            {analyzing ? "Анализ…" : "🤖 Проанализировать новые"}
          </button>
        </div>
      </div>

      {!aiEnabled && (
        <p className="mb-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          ИИ-анализ выключен: на сервере не задан ANTHROPIC_API_KEY. Список ниже
          основан на правилах (последним писал клиент и это не закрывающее
          сообщение).
        </p>
      )}

      {items.length === 0 ? (
        <p className="text-gray-500 text-sm">Нет чатов, ожидающих ответа. 🎉</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-3">№ / Чат</th>
                <th className="py-2 pr-3">Бухгалтер</th>
                <th className="py-2 pr-3">Ждёт</th>
                <th className="py-2 pr-3">Последнее сообщение клиента</th>
                <th className="py-2 pr-3">🤖 Вывод</th>
                <th className="py-2 pr-3 text-right">Подтверждение</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const wait = waitingLabel(it.last_activity_at, nowISO);
                const confirmed = it.human_unanswered === true;
                return (
                  <tr
                    key={it.agr_no}
                    className="border-b border-gray-100 align-top"
                  >
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <div className="font-medium text-gray-900">{it.agr_no}</div>
                      <div className="text-gray-500 max-w-[16rem] truncate">
                        {isTelegramLink(it.chat_link) ? (
                          <a
                            href={it.chat_link!}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            {it.chat_name}
                          </a>
                        ) : (
                          it.chat_name
                        )}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-gray-700 whitespace-nowrap">
                      {it.accountant ?? "—"}
                    </td>
                    <td className="py-2 pr-3 text-gray-700 whitespace-nowrap">
                      {wait ? wait.replace("ждёт ", "") : "—"}
                    </td>
                    <td className="py-2 pr-3 text-gray-700 max-w-[22rem]">
                      <div className="line-clamp-3">
                        {it.last_msg_text ?? "—"}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-gray-600 max-w-[18rem]">
                      {it.ai_reason ? (
                        <div>
                          <span>{it.ai_reason}</span>
                          {it.ai_confidence && (
                            <span className="ml-1 text-gray-400">
                              (увер.: {CONFIDENCE_LABEL[it.ai_confidence] ?? it.ai_confidence})
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400">по правилам</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">
                      {confirmed && (
                        <span className="mr-2 text-xs text-green-700">✔ подтв.</span>
                      )}
                      <button
                        onClick={() => label(it.agr_no, true)}
                        disabled={busy === it.agr_no}
                        className="px-2 py-1 rounded bg-orange-100 text-orange-800 hover:bg-orange-200 disabled:opacity-50"
                        title="Подтвердить: чат ждёт ответа"
                      >
                        ✔ ждёт
                      </button>
                      <button
                        onClick={() => label(it.agr_no, false)}
                        disabled={busy === it.agr_no}
                        className="ml-1 px-2 py-1 rounded bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                        title="Отклонить: ответа не требуется"
                      >
                        ✘ не нужно
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
