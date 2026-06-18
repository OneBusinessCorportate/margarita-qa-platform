"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isTelegramLink } from "@/lib/chat-list";
import { slaWaitLabel } from "@/lib/unanswered";
import type { LateAnswerItem, UnansweredQueueItem } from "@/lib/repo";

function ChatLink({
  name,
  link,
}: {
  name: string;
  link: string | null;
}) {
  return isTelegramLink(link) ? (
    <a
      href={link!}
      target="_blank"
      rel="noreferrer"
      className="text-blue-600 hover:underline font-medium"
    >
      {name}
    </a>
  ) : (
    <span className="font-medium text-gray-900">{name}</span>
  );
}

// The simplest possible triage list: chats we owe a reply on (pick a status),
// plus a short list of recent late answers (already replied, just for review).
export default function UnansweredPanel({
  items,
  late,
}: {
  items: UnansweredQueueItem[];
  late: LateAnswerItem[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function setStatus(agr_no: string, status: string) {
    setBusy(agr_no);
    try {
      await fetch("/api/unanswered/label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agr_no, status }),
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-lg font-semibold text-gray-900 mb-4">
        Без ответа ({items.length})
      </h1>

      {items.length === 0 ? (
        <p className="text-gray-500">Всё отвечено 🎉</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {items.map((it) => (
              <tr key={it.agr_no} className="border-b border-gray-100 align-top">
                <td className="py-3 pr-4 whitespace-nowrap">
                  <ChatLink name={it.chat_name} link={it.chat_link} />
                  <div className="text-xs text-gray-400">
                    {it.agr_no} · {it.accountant ?? "—"} · ждёт{" "}
                    {slaWaitLabel(it.hours_ago)}
                  </div>
                </td>
                <td className="py-3 pr-4 text-gray-700">
                  <div className="line-clamp-2">{it.problem_text ?? "—"}</div>
                </td>
                <td className="py-3 text-right whitespace-nowrap">
                  <select
                    value={it.human_status ?? ""}
                    disabled={busy === it.agr_no}
                    onChange={(e) => setStatus(it.agr_no, e.target.value)}
                    className="border border-gray-300 rounded px-2 py-1 disabled:opacity-50"
                  >
                    <option value="" disabled>
                      —
                    </option>
                    <option value="waiting">Ждёт</option>
                    <option value="warned">Предупредила</option>
                    <option value="answered">Ответили</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {late.length > 0 && (
        <>
          <h2 className="text-base font-semibold text-gray-900 mt-8 mb-3">
            Поздний ответ ({late.length})
          </h2>
          <table className="w-full text-sm">
            <tbody>
              {late.map((it) => (
                <tr key={it.agr_no} className="border-b border-gray-100 align-top">
                  <td className="py-3 pr-4 whitespace-nowrap">
                    <ChatLink name={it.chat_name} link={it.chat_link} />
                    <div className="text-xs text-gray-400">
                      {it.agr_no} · {it.accountant ?? "—"} · ждал{" "}
                      {slaWaitLabel(it.hours_ago)}
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-gray-700">
                    <div className="line-clamp-2">{it.problem_text ?? "—"}</div>
                  </td>
                  <td className="py-3 text-right whitespace-nowrap text-xs text-gray-500">
                    ответил(а) {it.responder_name ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
