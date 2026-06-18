"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { debtAmountLabel, isTelegramLink } from "@/lib/chat-list";
import { slaWaitLabel } from "@/lib/unanswered";
import type {
  UnansweredCounts,
  UnansweredMode,
  UnansweredQueueItem,
} from "@/lib/repo";

const TABS: { id: UnansweredMode; label: string }[] = [
  { id: "unanswered", label: "Без ответа" },
  { id: "watched", label: "На контроле" },
];

const CLASS_LABEL: Record<string, string> = {
  problematic_not_critical: "проблемный",
  needs_human_review: "проверка",
  answered: "✅ ответили",
};

// Dense, spreadsheet-style table — mirrors the «КК Сопровождение» Google Sheet:
// one row per chat, clickable chat link, accountant, red Долг when owed, longest
// wait on top. Only the chats WE owe a reply on (canonical QA/SLA logic).
export default function UnansweredPanel({
  items,
  counts,
  mode,
}: {
  items: UnansweredQueueItem[];
  counts: UnansweredCounts;
  mode: UnansweredMode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

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

  const setStatus = (agr_no: string, status: string) =>
    call("/api/unanswered/label", { agr_no, status }, agr_no);
  const watch = (agr_no: string, watched: boolean) =>
    call("/api/unanswered/watch", { agr_no, watched }, agr_no);

  // Her dropdown style: colored chip per chosen status (like the green cells in
  // «КК Сопровождение»). Empty = not yet reviewed.
  const statusClass = (s: string | null) =>
    s === "answered"
      ? "bg-green-100 text-green-800 border-green-300"
      : s === "warned"
      ? "bg-blue-100 text-blue-800 border-blue-300"
      : s === "waiting"
      ? "bg-orange-100 text-orange-800 border-orange-300"
      : "bg-white text-gray-500 border-gray-300";

  const th = "border border-gray-300 bg-gray-100 px-2 py-1 text-left font-semibold text-gray-700";
  const td = "border border-gray-200 px-2 py-1 align-top";

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-semibold text-gray-900">Без ответа</h1>
        {note && <span className="text-sm text-red-600">{note}</span>}
      </div>
      <p className="text-xs text-gray-400 mb-3">
        Логика SLA: рабочие часы (Ереван, Пн–Пт 10:00–19:00). Показаны только чаты,
        где ответ за нами.
      </p>

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
                <th className={`${th} whitespace-nowrap`}>Сколько</th>
                <th className={th}>Сообщение клиента</th>
                <th className={`${th} text-center`}>Статус</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => {
                const debt = debtAmountLabel(it.debts);
                const tag = CLASS_LABEL[it.classification];
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
                      {mode === "watched" && tag && (
                        <span className="ml-1 text-[11px] text-gray-400">({tag})</span>
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
                    <td
                      className={`${td} whitespace-nowrap font-medium ${
                        it.severity === "critical" ? "text-red-700" : "text-orange-700"
                      }`}
                    >
                      {slaWaitLabel(it.hours_ago)}
                    </td>
                    <td className={`${td} text-gray-700 max-w-[28rem]`}>
                      <div className="line-clamp-3">{it.problem_text ?? "—"}</div>
                    </td>
                    <td className={`${td} text-center whitespace-nowrap`}>
                      <select
                        value={it.human_status ?? ""}
                        disabled={busy === it.agr_no}
                        onChange={(e) => setStatus(it.agr_no, e.target.value)}
                        className={`rounded border px-1.5 py-0.5 text-xs ${statusClass(
                          it.human_status
                        )} disabled:opacity-50`}
                        title="Статус (как в таблице)"
                      >
                        <option value="" disabled>
                          —
                        </option>
                        <option value="waiting">Ждёт ответа</option>
                        <option value="warned">Предупредила</option>
                        <option value="answered">Ответили</option>
                      </select>
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
