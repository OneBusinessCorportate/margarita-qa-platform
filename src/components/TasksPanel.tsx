"use client";

import { useMemo, useState } from "react";
import {
  SINGLE_TASK_STATUSES,
  TASK_PRIORITIES,
  isTaskClosed,
  isTaskDue,
} from "@/lib/scoring";
import { matchesChatQuery } from "@/lib/chat-list";
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
  recurring: boolean;
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
    recurring: false,
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
  const [openOnly, setOpenOnly] = useState(true);
  // Quick find by contract № / название / бухгалтер (item 7 — искать нужный чат
  // среди 100+ задач вручную было неудобно; «Поиск по номеру договора — ок»).
  const [search, setSearch] = useState("");

  const chatMap = useMemo(() => new Map(chats.map((c) => [c.agr_no, c])), [chats]);
  const asOf = today();

  // Does a task match the search box? Matches the chat (№ / name / link via
  // matchesChatQuery), plus the task's own accountant and description text.
  const taskMatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (t: Task): boolean => {
      if (!q) return true;
      const chat = chatMap.get(t.chat_agr_no);
      if (chat && matchesChatQuery(chat, q)) return true;
      return (
        t.chat_agr_no.toLowerCase().includes(q) ||
        (t.accountant ?? "").toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q)
      );
    };
  }, [search, chatMap]);

  // Open tasks first, with the most-overdue at the top — Margarita's chase list.
  const sorted = useMemo(() => {
    const dueKey = (t: Task) => t.due_date_postponed || t.due_date_original || "9999-99-99";
    return [...tasks]
      .filter((t) => (openOnly ? !isTaskClosed(t) : true))
      .filter(taskMatches)
      .sort((a, b) => {
        const ao = isTaskClosed(a) ? 1 : 0;
        const bo = isTaskClosed(b) ? 1 : 0;
        if (ao !== bo) return ao - bo; // open before closed
        return dueKey(a).localeCompare(dueKey(b)); // soonest / most overdue first
      });
  }, [tasks, openOnly, taskMatches]);

  const openCount = useMemo(() => tasks.filter((t) => !isTaskClosed(t)).length, [tasks]);
  const dueCount = useMemo(
    () => tasks.filter((t) => isTaskDue(t, asOf)).length,
    [tasks, asOf]
  );

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
          recurring: draft.recurring,
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

  // PATCH an existing task (status, completion, QA confirmation) and reflect it.
  async function patchTask(id: string, patch: Record<string, unknown>) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const updated: Task = await res.json();
        setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
      }
    } catch {
      /* optimistic update already applied; a refresh will reconcile */
    }
  }

  function pickChat(agrNo: string) {
    const c = chatMap.get(agrNo);
    setDraft({ ...draft, chat_agr_no: agrNo, accountant: c?.accountant ?? draft.accountant });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <input
          className="input min-w-[240px] grow max-w-md"
          placeholder="Поиск: № договора, название чата, бухгалтер…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button className="btn-secondary text-xs" onClick={() => setSearch("")}>
            Сброс
          </button>
        )}
        <label className="flex items-center gap-1.5 text-gray-600">
          <input
            type="checkbox"
            checked={openOnly}
            onChange={(e) => setOpenOnly(e.target.checked)}
          />
          Только открытые
        </label>
        <span className="inline-block rounded bg-amber-50 text-amber-700 font-medium px-2 py-1 text-xs">
          Открытых: {openCount}
        </span>
        <span className="inline-block rounded bg-red-50 text-red-700 font-medium px-2 py-1 text-xs">
          Подошёл срок: {dueCount}
        </span>
        {search && (
          <span className="text-xs text-gray-400">Найдено: {sorted.length}</span>
        )}
      </div>

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
              <th>Повтор</th>
              <th>Статус</th>
              <th>Состояние</th>
              <th>QA подтвердил</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => {
              const chat = chatMap.get(t.chat_agr_no);
              const due = isTaskDue(t, asOf);
              const closed = isTaskClosed(t);
              // A recurring task done by the accountant but awaiting QA confirmation.
              const awaitingQa =
                t.recurring === true &&
                (t.task_status === "Completed (On Time)" ||
                  t.task_status === "Completed (Late)") &&
                t.qa_confirmed !== true;
              return (
                <tr key={t.id} className={due ? "bg-red-50/60" : closed ? "bg-gray-50/60" : ""}>
                  <td>
                    <div className="font-medium">№ {t.chat_agr_no}</div>
                    <div className="text-gray-500 text-xs">{chat?.chat_name ?? "—"}</div>
                    <div className="text-gray-400 text-xs">{t.accountant ?? "—"}</div>
                  </td>
                  <td className="text-xs text-gray-700">{t.description}</td>
                  <td className={`whitespace-nowrap text-xs ${due ? "text-red-600 font-semibold" : ""}`}>
                    {t.due_date_original ?? "—"}
                    {due && <span className="block">⏰ срок подошёл</span>}
                  </td>
                  <td className="whitespace-nowrap text-xs">{t.due_date_postponed ?? "—"}</td>
                  <td className="text-xs">{t.priority ?? "—"}</td>
                  <td className="text-xs text-center">
                    {t.recurring ? (
                      <span title="Повторяющаяся / незакрываемая — закроется только после подтверждения QA">
                        🔁
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="text-xs whitespace-nowrap">
                    <select
                      className="input text-xs"
                      value={t.task_status ?? "-"}
                      onChange={(e) =>
                        patchTask(t.id, {
                          task_status: e.target.value,
                          completed_at:
                            e.target.value.startsWith("Completed") && !t.completed_at
                              ? today()
                              : t.completed_at,
                        })
                      }
                    >
                      {SINGLE_TASK_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="text-xs whitespace-nowrap">
                    {closed ? (
                      <span className="text-green-700 font-medium">✓ закрыта</span>
                    ) : awaitingQa ? (
                      <span className="text-amber-700 font-medium">ждёт QA</span>
                    ) : (
                      <span className="text-gray-500">открыта</span>
                    )}
                  </td>
                  <td className="text-xs whitespace-nowrap">
                    {t.recurring ? (
                      <label className="inline-flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={t.qa_confirmed === true}
                          onChange={(e) =>
                            patchTask(t.id, { qa_confirmed: e.target.checked })
                          }
                        />
                        {t.qa_confirmed ? "подтверждено" : "подтвердить"}
                      </label>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
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
                  placeholder="напр. «вернётся с ответом через 2 дня»"
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
              <td className="text-center">
                <input
                  type="checkbox"
                  checked={draft.recurring}
                  onChange={(e) => setDraft({ ...draft, recurring: e.target.checked })}
                  title="Повторяющаяся / незакрываемая задача — закроется только после подтверждения QA"
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
              <td className="text-xs text-gray-400">новая</td>
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
