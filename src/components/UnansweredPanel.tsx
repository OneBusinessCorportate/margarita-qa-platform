"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isTelegramLink } from "@/lib/chat-list";
import { slaWaitLabel } from "@/lib/unanswered";
import type { UnansweredQueueItem } from "@/lib/repo";

// The simplest possible triage list: the chats we owe a reply on. Click the chat
// to read it in Telegram, pick one status. That's it.
export default function UnansweredPanel({
  items,
}: {
  items: UnansweredQueueItem[];
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
                  {isTelegramLink(it.chat_link) ? (
                    <a
                      href={it.chat_link!}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:underline font-medium"
                    >
                      {it.chat_name}
                    </a>
                  ) : (
                    <span className="font-medium text-gray-900">{it.chat_name}</span>
                  )}
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
    </div>
  );
}
