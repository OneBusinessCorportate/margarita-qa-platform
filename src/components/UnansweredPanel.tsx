"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { debtAmountLabel, isTelegramLink, waitingLabel } from "@/lib/chat-list";
import type {
  UnansweredCounts,
  UnansweredMode,
  UnansweredQueueItem,
} from "@/lib/repo";

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "высокая",
  medium: "средняя",
  low: "низкая",
};

const TABS: { id: UnansweredMode; label: string }[] = [
  { id: "staff", label: "Ждут нас" },
  { id: "client", label: "Ждём клиента" },
  { id: "watched", label: "На контроле" },
  { id: "all", label: "Все" },
];

// Dense, spreadsheet-style table — mirrors the «КК Сопровождение» Google Sheet
// Margarita works in: one row per chat, clickable chat link, accountant, a red
// "Долг" cell when money is owed, problems on top. Her old manual flow was: see
// an unfinished communication → leave it unread → mark it → re-check later if it
// was answered. Here that becomes: «Ждём» (кого ждём), ⭐ «на контроле», and the
// queue auto-re-checks, showing ✅ when a watched chat finally got answered.
export default function UnansweredPanel({
  items,
  counts,
  mode,
  aiEnabled,
}: {
  items: UnansweredQueueItem[];
  counts: UnansweredCounts;
  mode: UnansweredMode;
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
        `Проанализировано: ${data.analyzed}. Ждут нас: ${data.flagged ?? 0}, закрыто/клиент: ${data.cleared ?? 0}.`
      );
      router.refresh();
    } catch (e: any) {
      setNote(e?.message ?? String(e));
    } finally {
      setAnalyzing(false);
    }
  }

  async function call(url: string, body: object, agr_no: string) {
    setBusy(agr_no);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  const label = (agr_no: string, unanswered: boolean) =>
    call("/api/unanswered/label", { agr_no, unanswered }, agr_no);
  const watch = (agr_no: string, watched: boolean) =>
    call("/api/unanswered/watch", { agr_no, watched }, agr_no);

  const th = "border border-gray-300 bg-gray-100 px-2 py-1 text-left font-semibold text-gray-700";
  const td = "border border-gray-200 px-2 py-1 align-top";

  function waitingBadge(it: UnansweredQueueItem) {
    // A watched chat that's no longer waiting on us / anyone = it got answered.
    if (it.watched && it.waiting_on !== "staff") {
      return <span className="text-green-700 font-medium">✅ ответили</span>;
    }
    if (it.waiting_on === "staff")
      return <span className="text-orange-700 font-medium">нас</span>;
    if (it.waiting_on === "client")
      return <span className="text-gray-500">клиента</span>;
    return <span className="text-gray-400">—</span>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-lg font-semibold text-gray-900">Без ответа</h1>
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

      {/* Filter tabs — like switching columns/filters in her sheet. */}
      <div className="flex items-center gap-1 mb-3">
        {TABS.map((t) => {
          const active = t.id === mode;
          return (
            <a
              key={t.id}
              href={`/unanswered?mode=${t.id}`}
              className={`px-3 py-1.5 rounded text-sm font-medium ${
                active ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {t.label}{" "}
              <span className={active ? "text-blue-400" : "text-gray-400"}>
                {counts[t.id]}
              </span>
            </a>
          );
        })}
      </div>

      {!aiEnabled && (
        <p className="mb-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          ИИ-анализ выключен: на сервере не задан ANTHROPIC_API_KEY. Список основан
          на правилах (последним писал клиент и это не закрывающее сообщение).
        </p>
      )}

      {items.length === 0 ? (
        <p className="text-gray-500 text-sm">Пусто. 🎉</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse w-full">
            <thead>
              <tr>
                <th className={`${th} text-center`}>★</th>
                <th className={th}>№</th>
                <th className={th}>Чат</th>
                <th className={th}>Бухгалтер</th>
                <th className={`${th} text-right`}>Долг</th>
                <th className={`${th} whitespace-nowrap`}>Ждём</th>
                <th className={`${th} whitespace-nowrap`}>Сколько</th>
                <th className={th}>Последнее сообщение</th>
                <th className={th}>🤖 Вывод</th>
                <th className={`${th} text-center`}>Решение</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => {
                const wait = waitingLabel(it.last_activity_at, nowISO);
                const confirmed = it.human_unanswered === true;
                const debt = debtAmountLabel(it.debts);
                return (
                  <tr key={it.agr_no} className={i % 2 ? "bg-gray-50/60" : ""}>
                    <td className={`${td} text-center`}>
                      <button
                        onClick={() => watch(it.agr_no, !it.watched)}
                        disabled={busy === it.agr_no}
                        title={it.watched ? "Снять с контроля" : "Поставить на контроль"}
                        className={`text-base leading-none ${
                          it.watched ? "text-amber-500" : "text-gray-300 hover:text-amber-400"
                        }`}
                      >
                        {it.watched ? "★" : "☆"}
                      </button>
                    </td>
                    <td className={`${td} font-medium text-gray-900 whitespace-nowrap`}>
                      {it.agr_no}
                    </td>
                    <td className={td}>
                      {isTelegramLink(it.chat_link) ? (
                        <a
                          href={it.chat_link!}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 hover:underline"
                          title="Открыть чат в Telegram"
                        >
                          {it.chat_name} ↗
                        </a>
                      ) : (
                        <span className="text-gray-700">{it.chat_name}</span>
                      )}
                    </td>
                    <td className={`${td} text-gray-700 whitespace-nowrap`}>
                      {it.accountant ?? "—"}
                    </td>
                    <td
                      className={`${td} text-right whitespace-nowrap ${
                        debt?.owed ? "bg-red-100 text-red-800 font-semibold" : "text-gray-400"
                      }`}
                    >
                      {debt ? debt.text.replace("долг ", "") : "—"}
                    </td>
                    <td className={`${td} whitespace-nowrap`}>{waitingBadge(it)}</td>
                    <td className={`${td} whitespace-nowrap text-gray-600`}>
                      {wait ? wait.replace("ждёт ", "") : "—"}
                    </td>
                    <td className={`${td} text-gray-700 max-w-[24rem]`}>
                      <div className="line-clamp-3">{it.last_msg_text ?? "—"}</div>
                    </td>
                    <td className={`${td} text-gray-600 max-w-[16rem]`}>
                      {it.ai_reason ? (
                        <span>
                          {it.ai_reason}
                          {it.ai_confidence && (
                            <span className="text-gray-400">
                              {" "}
                              ({CONFIDENCE_LABEL[it.ai_confidence] ?? it.ai_confidence})
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-gray-400">по правилам</span>
                      )}
                    </td>
                    <td className={`${td} text-center whitespace-nowrap`}>
                      {confirmed && (
                        <span className="mr-1 text-[11px] text-green-700">✔</span>
                      )}
                      <button
                        onClick={() => label(it.agr_no, true)}
                        disabled={busy === it.agr_no}
                        className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 hover:bg-orange-200 disabled:opacity-50"
                        title="Подтвердить: ждёт нашего ответа"
                      >
                        ждёт
                      </button>
                      <button
                        onClick={() => label(it.agr_no, false)}
                        disabled={busy === it.agr_no}
                        className="ml-1 px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                        title="Отклонить: ответа от нас не требуется"
                      >
                        решено
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
