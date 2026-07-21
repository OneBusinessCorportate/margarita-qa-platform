"use client";

import { useEffect, useMemo, useState } from "react";
import {
  SYSTEM_TASK_PRIORITIES,
  SYSTEM_TASK_PRIORITY_LABEL,
  SYSTEM_TASK_STATUSES,
  SYSTEM_TASK_STATUS_LABEL,
  summarizeSystemTasks,
} from "@/lib/system-tasks";
import type {
  Accountant,
  AccountantSystemTask,
  SystemTaskPriority,
  SystemTaskStatus,
} from "@/lib/types";

const STATUS_STYLE: Record<SystemTaskStatus, string> = {
  new: "bg-gray-100 text-gray-700",
  in_progress: "bg-blue-50 text-blue-700",
  postponed: "bg-amber-50 text-amber-700",
  completed: "bg-green-50 text-green-700",
  cancelled: "bg-red-50 text-red-700",
};

interface Draft {
  accountant_name: string;
  client_name: string;
  chat_id: string;
  ticket_id: string;
  title: string;
  description: string;
  priority: SystemTaskPriority;
  due_date_original: string;
}

function blankDraft(): Draft {
  return {
    accountant_name: "",
    client_name: "",
    chat_id: "",
    ticket_id: "",
    title: "",
    description: "",
    priority: "Medium",
    due_date_original: "",
  };
}

function fmtDate(v: string | null): string {
  if (!v) return "—";
  return String(v).slice(0, 10).split("-").reverse().join(".");
}

function fmtDateTime(v: string | null): string {
  if (!v) return "—";
  const d = String(v).slice(0, 10).split("-").reverse().join(".");
  const t = String(v).slice(11, 16);
  return t ? `${d} ${t}` : d;
}

export default function SystemTasksPanel({
  accountants,
  initialTasks,
}: {
  accountants: Accountant[];
  initialTasks: AccountantSystemTask[];
}) {
  const [tasks, setTasks] = useState<AccountantSystemTask[]>(initialTasks);
  // Re-sync when AutoRefresh streams fresh server props (state was seeded once →
  // new/edited tasks only showed after a full reload). Mirrors ScoringPanel.
  useEffect(() => {
    setTasks(initialTasks);
  }, [initialTasks]);
  const [draft, setDraft] = useState<Draft>(blankDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accFilter, setAccFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | SystemTaskStatus>("");
  const [openOnly, setOpenOnly] = useState(false);

  const accountantNames = useMemo(
    () => [...new Set(accountants.map((a) => a.name).filter(Boolean))].sort(),
    [accountants]
  );

  const visible = useMemo(() => {
    return tasks.filter((t) => {
      if (accFilter && (t.accountant_name ?? "") !== accFilter) return false;
      if (statusFilter && t.status !== statusFilter) return false;
      if (openOnly && (t.status === "completed" || t.status === "cancelled")) return false;
      return true;
    });
  }, [tasks, accFilter, statusFilter, openOnly]);

  const summary = useMemo(() => summarizeSystemTasks(tasks), [tasks]);

  async function create() {
    if (!draft.title.trim()) {
      setError("Название задачи обязательно");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/system-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountant_name: draft.accountant_name || null,
          client_name: draft.client_name || null,
          chat_id: draft.chat_id || null,
          ticket_id: draft.ticket_id || null,
          title: draft.title.trim(),
          description: draft.description || null,
          priority: draft.priority,
          due_date_original: draft.due_date_original || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Ошибка сохранения");
        return;
      }
      const created = (await res.json()) as AccountantSystemTask;
      setTasks((prev) => [created, ...prev]);
      setDraft(blankDraft());
    } catch {
      setError("Сетевая ошибка");
    } finally {
      setSaving(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    // Optimistic — revert on failure.
    const prev = tasks;
    setTasks((cur) => cur.map((t) => (t.id === id ? { ...t, ...body } as AccountantSystemTask : t)));
    try {
      const res = await fetch(`/api/system-tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Ошибка обновления");
        setTasks(prev);
        return;
      }
      const updated = (await res.json()) as AccountantSystemTask;
      setTasks((cur) => cur.map((t) => (t.id === id ? updated : t)));
    } catch {
      setError("Сетевая ошибка");
      setTasks(prev);
    }
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="px-2 py-1 rounded bg-gray-100">Всего: {summary.total}</span>
        <span className="px-2 py-1 rounded bg-gray-100">Открытых: {summary.open}</span>
        {SYSTEM_TASK_STATUSES.map((s) => (
          <span key={s} className={`px-2 py-1 rounded ${STATUS_STYLE[s]}`}>
            {SYSTEM_TASK_STATUS_LABEL[s]}: {summary[s]}
          </span>
        ))}
      </div>

      {/* Create form */}
      <div className="card p-3 space-y-2">
        <div className="text-sm font-medium">Новая задача</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input
            className="input"
            placeholder="Название задачи *"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          <select
            className="input"
            value={draft.accountant_name}
            onChange={(e) => setDraft({ ...draft, accountant_name: e.target.value })}
          >
            <option value="">Бухгалтер —</option>
            {accountantNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={draft.priority}
            onChange={(e) =>
              setDraft({ ...draft, priority: e.target.value as SystemTaskPriority })
            }
          >
            {SYSTEM_TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                Приоритет: {SYSTEM_TASK_PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
          <input
            className="input"
            placeholder="Клиент"
            value={draft.client_name}
            onChange={(e) => setDraft({ ...draft, client_name: e.target.value })}
          />
          <input
            className="input"
            placeholder="Чат (код/ссылка)"
            value={draft.chat_id}
            onChange={(e) => setDraft({ ...draft, chat_id: e.target.value })}
          />
          <input
            className="input"
            placeholder="QA тикет (id нарушения)"
            value={draft.ticket_id}
            onChange={(e) => setDraft({ ...draft, ticket_id: e.target.value })}
          />
          <input
            className="input"
            type="date"
            title="Due Date (original)"
            value={draft.due_date_original}
            onChange={(e) => setDraft({ ...draft, due_date_original: e.target.value })}
          />
          <textarea
            className="input md:col-span-2"
            placeholder="Описание"
            rows={1}
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-primary" onClick={create} disabled={saving}>
            {saving ? "Сохранение…" : "Добавить задачу"}
          </button>
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select className="input" value={accFilter} onChange={(e) => setAccFilter(e.target.value)}>
          <option value="">Все бухгалтеры</option>
          {accountantNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "" | SystemTaskStatus)}
        >
          <option value="">Все статусы</option>
          {SYSTEM_TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {SYSTEM_TASK_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
          Только открытые
        </label>
        <span className="text-gray-500">Показано: {visible.length}</span>
      </div>

      {/* List */}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="py-2 pr-3">Задача</th>
              <th className="py-2 pr-3">Бухгалтер</th>
              <th className="py-2 pr-3">Клиент / чат</th>
              <th className="py-2 pr-3">QA тикет</th>
              <th className="py-2 pr-3">Приоритет</th>
              <th className="py-2 pr-3">Статус</th>
              <th className="py-2 pr-3">Срок</th>
              <th className="py-2 pr-3">Отложен до</th>
              <th className="py-2 pr-3">Выполнено</th>
              <th className="py-2 pr-3">Автор / создано</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={10} className="py-4 text-center text-gray-400">
                  Задач нет
                </td>
              </tr>
            )}
            {visible.map((t) => (
              <tr key={t.id} className="border-b align-top">
                <td className="py-2 pr-3">
                  <div className="font-medium">{t.title}</div>
                  {t.description && <div className="text-xs text-gray-500">{t.description}</div>}
                </td>
                <td className="py-2 pr-3">{t.accountant_name || "—"}</td>
                <td className="py-2 pr-3">
                  {t.client_name || "—"}
                  {t.chat_id && <div className="text-xs text-gray-500">{t.chat_id}</div>}
                </td>
                <td className="py-2 pr-3 text-xs text-gray-500">{t.ticket_id || "—"}</td>
                <td className="py-2 pr-3">
                  <select
                    className="input py-1"
                    value={t.priority}
                    onChange={(e) => patch(t.id, { priority: e.target.value })}
                  >
                    {SYSTEM_TASK_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {SYSTEM_TASK_PRIORITY_LABEL[p]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 pr-3">
                  <select
                    className={`input py-1 ${STATUS_STYLE[t.status]}`}
                    value={t.status}
                    onChange={(e) => patch(t.id, { status: e.target.value })}
                  >
                    {SYSTEM_TASK_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {SYSTEM_TASK_STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(t.due_date_original)}</td>
                <td className="py-2 pr-3">
                  <input
                    type="date"
                    className="input py-1"
                    value={t.due_date_postponed ? String(t.due_date_postponed).slice(0, 10) : ""}
                    onChange={(e) => patch(t.id, { due_date_postponed: e.target.value || null })}
                  />
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">{fmtDateTime(t.completed_at)}</td>
                <td className="py-2 pr-3 text-xs text-gray-500 whitespace-nowrap">
                  {t.created_by || "—"}
                  <div>{fmtDateTime(t.created_at)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
