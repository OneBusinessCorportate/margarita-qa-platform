"use client";

import { useMemo, useState } from "react";
import { SINGLE_TASK_STATUSES, TASK_PRIORITIES } from "@/lib/scoring";
import type { Accountant, Chat, Task } from "@/lib/types";

const today = () => new Date().toISOString().slice(0, 10);

interface Draft {
  chat_agr_no: string;
  accountant: string;
  description: string;
  due_date_original: string;
  due_date_postponed: string;
  priority: string;
  completed_at: string;
  result: string;
  task_status: string;
}

function blankDraft(): Draft {
  return {
    chat_agr_no: "",
    accountant: "",
    description: "",
    due_date_original: today(),
    due_date_postponed: "",
    priority: "Medium",
    completed_at: "",
    result: "",
    task_status: "-",
  };
}

export default function TasksPanel({
  chats,
  accountants,
  initialTasks,
}: {
  chats: Chat[];
  accountants: Accountant[];
  initialTasks: Task[];
}) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [draft, setDraft] = useState<Draft>(blankDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chatMap = useMemo(() => new Map(chats.map((c) => [c.agr_no, c])), [chats]);

  async function save() {
    if (!draft.chat_agr_no) {
      setError("Выберите чат");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_agr_no: draft.chat_agr_no,
          accountant: draft.accountant || null,
          description: draft.description || null,
          due_date_original: draft.due_date_original || null,
          due_date_postponed: draft.due_date_postponed || null,
          priority: draft.priority,
          completed_at: draft.completed_at || null,
          result: draft.result || null,
          task_status: draft.task_status,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Не удалось сохранить");
        return;
      }
      const saved: Task = await res.json();
      setTasks((prev) => [saved, ...prev]);
      setDraft(blankDraft());
    } catch {
      setError("Сетевая ошибка");
    } finally {
      setSaving(false);
    }
  }

  function pickChat(agrNo: string) {
    const c = chatMap.get(agrNo);
    setDraft({ ...draft, chat_agr_no: agrNo, accountant: c?.accountant ?? draft.accountant });
  }

  return (
    <div className="space-y-3">
      {error && <div className="text-sm text-red-600 px-1">{error}</div>}
      <div className="card overflow-x-auto">
        <table className="qa">
          <thead>
            <tr>
              <th className="min-w-[200px]">№ / Чат / Бухгалтер</th>
              <th className="min-w-[200px]">Описание</th>
              <th>Срок</th>
              <th>Перенос</th>
              <th>Приоритет</th>
              <th>Завершено</th>
              <th>Результат</th>
              <th>Статус</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => {
              const chat = chatMap.get(t.chat_agr_no);
              return (
                <tr key={t.id}>
                  <td>
                    <div className="font-medium">№ {t.chat_agr_no}</div>
                    <div className="text-gray-500 text-xs">{chat?.chat_name ?? "—"}</div>
                    <div className="text-gray-400 text-xs">{t.accountant ?? "—"}</div>
                  </td>
                  <td className="text-xs text-gray-700">{t.description}</td>
                  <td className="whitespace-nowrap text-xs">{t.due_date_original ?? "—"}</td>
                  <td className="whitespace-nowrap text-xs">{t.due_date_postponed ?? "—"}</td>
                  <td className="text-xs">{t.priority ?? "—"}</td>
                  <td className="whitespace-nowrap text-xs">{t.completed_at ?? "—"}</td>
                  <td className="text-xs">{t.result ?? "—"}</td>
                  <td className="text-xs whitespace-nowrap">{t.task_status ?? "—"}</td>
                  <td></td>
                </tr>
              );
            })}
            {/* New row */}
            <tr className="bg-blue-50/40">
              <td className="space-y-1">
                <select
                  className="input w-full"
                  value={draft.chat_agr_no}
                  onChange={(e) => pickChat(e.target.value)}
                >
                  <option value="">— выберите чат —</option>
                  {chats.map((c) => (
                    <option key={c.agr_no} value={c.agr_no}>
                      № {c.agr_no} — {c.chat_name}
                    </option>
                  ))}
                </select>
                <select
                  className="input w-full"
                  value={draft.accountant}
                  onChange={(e) => setDraft({ ...draft, accountant: e.target.value })}
                >
                  <option value="">— бухгалтер —</option>
                  {accountants.map((a) => (
                    <option key={a.name} value={a.name}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  className="input w-full"
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  placeholder="описание задачи…"
                />
              </td>
              <td>
                <input
                  type="date"
                  className="input w-[130px]"
                  value={draft.due_date_original}
                  onChange={(e) => setDraft({ ...draft, due_date_original: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="date"
                  className="input w-[130px]"
                  value={draft.due_date_postponed}
                  onChange={(e) => setDraft({ ...draft, due_date_postponed: e.target.value })}
                />
              </td>
              <td>
                <select
                  className="input"
                  value={draft.priority}
                  onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
                >
                  {TASK_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  type="date"
                  className="input w-[130px]"
                  value={draft.completed_at}
                  onChange={(e) => setDraft({ ...draft, completed_at: e.target.value })}
                />
              </td>
              <td>
                <input
                  className="input w-[120px]"
                  value={draft.result}
                  onChange={(e) => setDraft({ ...draft, result: e.target.value })}
                />
              </td>
              <td>
                <select
                  className="input text-xs"
                  value={draft.task_status}
                  onChange={(e) => setDraft({ ...draft, task_status: e.target.value })}
                >
                  {SINGLE_TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <button
                  className="btn-primary"
                  onClick={save}
                  disabled={saving || !draft.chat_agr_no}
                >
                  {saving ? "…" : "Добавить"}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
