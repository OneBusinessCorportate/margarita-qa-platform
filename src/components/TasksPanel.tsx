"use client";

import { useEffect, useMemo, useState } from "react";
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
  /** Кого назначаем/оцениваем — выбирается ПЕРВЫМ (бухгалтер или менеджер). */
  subject: "accountant" | "manager";
  accountant: string;
  manager: string;
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
    subject: "accountant",
    accountant: "",
    manager: "",
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
  // Re-sync when AutoRefresh streams fresh server props (state was seeded once →
  // new/edited tasks only showed after a full reload). Mirrors ScoringPanel.
  useEffect(() => {
    setTasks(initialTasks);
  }, [initialTasks]);
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
        (t.manager ?? "").toLowerCase().includes(q) ||
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
          // Send ONLY the chosen subject — picking «Менеджер» no longer also
          // submits an auto-filled accountant (QA complaint).
          accountant: draft.subject === "accountant" ? draft.accountant || null : null,
          manager: draft.subject === "manager" ? draft.manager || null : null,
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

  // PATCH an existing task (status, completion, QA confirmation) and reflect it.
  // Optimistic, but if the server rejects it we ROLL BACK and surface the error
  // — otherwise a failed save silently "sticks" in the UI and reverts on reload.
  async function patchTask(id: string, patch: Record<string, unknown>) {
    const before = tasks.find((t) => t.id === id);
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        if (before) setTasks((prev) => prev.map((t) => (t.id === id ? before : t)));
        setError(d.error || "Не удалось сохранить изменение задачи");
        return;
      }
      const updated: Task = await res.json();
      setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
    } catch {
      if (before) setTasks((prev) => prev.map((t) => (t.id === id ? before : t)));
      setError("Сетевая ошибка — изменение задачи не сохранено");
    }
  }

  function pickChat(agrNo: string) {
    const c = chatMap.get(agrNo);
    setDraft({
      ...draft,
      chat_agr_no: agrNo,
      accountant: c?.accountant ?? draft.accountant,
      manager: c?.manager ?? draft.manager,
    });
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
              <th className="min-w-[200px]">№ / Чат / Бухгалтер · Менеджер</th>
              <th className="min-w-[200px]">Описание</th>
              <th>Due Date (Original)</th>
              <th>Due Date (Postponed)</th>
              <th>Completed At</th>
              <th>Приоритет</th>
              <th>Статус</th>
              <th>Состояние</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => {
              const chat = chatMap.get(t.chat_agr_no);
              const due = isTaskDue(t, asOf);
              const closed = isTaskClosed(t);
              return (
                <tr key={t.id} className={due ? "bg-red-50/60" : closed ? "bg-gray-50/60" : ""}>
                  <td>
                    <div className="font-medium">№ {t.chat_agr_no}</div>
                    <div className="text-gray-500 text-xs">{chat?.chat_name ?? "—"}</div>
                    <div className="text-gray-400 text-xs">
                      {t.accountant ? <>Б: {t.accountant}</> : null}
                      {t.accountant && t.manager ? " · " : null}
                      {t.manager ? <>М: {t.manager}</> : null}
                      {!t.accountant && !t.manager ? "—" : null}
                    </div>
                  </td>
                  <td className="text-xs text-gray-700">{t.description}</td>
                  <td className={`whitespace-nowrap text-xs ${due ? "text-red-600 font-semibold" : ""}`}>
                    <input
                      type="date"
                      className="input w-[130px]"
                      value={t.due_date_original ?? ""}
                      onChange={(e) =>
                        patchTask(t.id, { due_date_original: e.target.value || null })
                      }
                    />
                    {due && <span className="block">⏰ срок подошёл</span>}
                  </td>
                  <td className="whitespace-nowrap text-xs">
                    <input
                      type="date"
                      className="input w-[130px]"
                      value={t.due_date_postponed ?? ""}
                      onChange={(e) =>
                        patchTask(t.id, { due_date_postponed: e.target.value || null })
                      }
                      title="Перенос срока — исходный срок остаётся в колонке слева"
                    />
                  </td>
                  <td className="whitespace-nowrap text-xs">
                    {t.task_status?.startsWith("Completed") ? (
                      <input
                        type="date"
                        className="input w-[130px]"
                        value={t.completed_at ?? ""}
                        onChange={(e) =>
                          patchTask(t.id, { completed_at: e.target.value || null })
                        }
                      />
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="text-xs">{t.priority ?? "—"}</td>
                  <td className="text-xs whitespace-nowrap">
                    <select
                      className="input text-xs"
                      value={t.task_status ?? "-"}
                      onChange={(e) =>
                        patchTask(t.id, {
                          task_status: e.target.value,
                          completed_at: e.target.value.startsWith("Completed")
                            ? (t.completed_at ?? today())
                            : null,
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
                    ) : (
                      <span className="text-gray-500">открыта</span>
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
                {/* СНАЧАЛА выбираем субъект (QA: «сначала выбрать — Менеджер или
                    конкретный бухгалтер»); ниже показываем ТОЛЬКО его селектор. */}
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, subject: "accountant" })}
                    className={`flex-1 rounded border px-2 py-1 text-xs ${
                      draft.subject === "accountant"
                        ? "border-sky-500 bg-sky-50 text-sky-700 font-medium"
                        : "border-gray-300 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    Бухгалтер
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, subject: "manager" })}
                    className={`flex-1 rounded border px-2 py-1 text-xs ${
                      draft.subject === "manager"
                        ? "border-sky-500 bg-sky-50 text-sky-700 font-medium"
                        : "border-gray-300 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    Менеджер
                  </button>
                </div>
                {draft.subject === "accountant" ? (
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
                ) : (
                  <select
                    className="input w-full"
                    value={draft.manager}
                    onChange={(e) => setDraft({ ...draft, manager: e.target.value })}
                  >
                    <option value="">— менеджер —</option>
                    {accountants.map((a) => (
                      <option key={a.name} value={a.name}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                )}
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
                <input
                  type="date"
                  className="input w-[130px]"
                  value={draft.completed_at}
                  onChange={(e) => setDraft({ ...draft, completed_at: e.target.value })}
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
