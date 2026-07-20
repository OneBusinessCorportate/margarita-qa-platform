"use client";

import { useEffect, useState } from "react";
import { SINGLE_TASK_STATUSES, TASK_PRIORITIES, isTaskClosed } from "@/lib/scoring";
import type { Task } from "@/lib/types";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Add a task without leaving the scoring page — mirrors ViolationModal, and now
 * carries the SAME fields as the «Задачи» page table so a task created here is
 * complete, not a stub: № / Чат / Бухгалтер, Описание, Due Date (Original),
 * Due Date (Postponed), Completed At, Приоритет, Статус и Состояние.
 * Pre-filled from the chat row; on save POSTs to /api/tasks.
 */
export default function TaskModal({
  chatAgrNo,
  client,
  accountant,
  manager = null,
  defaultDate,
  onClose,
  onSaved,
}: {
  chatAgrNo: string;
  client: string | null;
  accountant: string | null;
  /** Ответственный менеджер по клиенту (из mqa_chats.manager). */
  manager?: string | null;
  defaultDate?: string;
  onClose: () => void;
  onSaved?: (t: Task) => void;
}) {
  const [dueDate, setDueDate] = useState(defaultDate ?? today());
  const [duePostponed, setDuePostponed] = useState("");
  const [completedAt, setCompletedAt] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [status, setStatus] = useState<string>("-");
  const [acc, setAcc] = useState(accountant ?? "");
  // Задачу можно назначить и менеджеру (запрос QA): предзаполняем из чата.
  const [mgr, setMgr] = useState(manager ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const closed = isTaskClosed({ task_status: status });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // When the status becomes «Completed …», default Completed At to today (as on
  // the Задачи page); clear it when the task is no longer completed.
  function changeStatus(next: string) {
    setStatus(next);
    if (next.startsWith("Completed")) {
      setCompletedAt((prev) => prev || today());
    } else {
      setCompletedAt("");
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_agr_no: chatAgrNo,
          accountant: acc || null,
          manager: mgr || null,
          description: description || null,
          due_date_original: dueDate || null,
          due_date_postponed: duePostponed || null,
          completed_at: completedAt || null,
          priority,
          task_status: status,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Не удалось сохранить");
        return;
      }
      const saved: Task = await res.json();
      onSaved?.(saved);
      setDone(true);
      setTimeout(onClose, 900);
    } catch {
      setError("Сетевая ошибка");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="card w-full max-w-md p-4 space-y-3 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">📋 Задача</h2>
          <button
            className="text-gray-400 hover:text-gray-700 text-lg leading-none px-1"
            onClick={onClose}
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>

        {/* № / Чат */}
        <div className="text-xs text-gray-500">
          {client ?? chatAgrNo}
          <span className="text-gray-400"> · № {chatAgrNo}</span>
        </div>

        {done ? (
          <div className="py-6 text-center text-green-700 font-medium">
            ✓ Задача добавлена
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Бухгалтер">
                <input
                  className="input w-full"
                  value={acc}
                  onChange={(e) => setAcc(e.target.value)}
                  placeholder="имя бухгалтера"
                />
              </Field>
              <Field label="Менеджер">
                <input
                  className="input w-full"
                  value={mgr}
                  onChange={(e) => setMgr(e.target.value)}
                  placeholder="имя менеджера"
                />
              </Field>
            </div>

            <Field label="Описание">
              <input
                className="input w-full"
                placeholder="напр. «вернётся с ответом через 2 дня»"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Due Date (Original)">
                <input
                  type="date"
                  className="input w-full"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </Field>
              <Field label="Due Date (Postponed)">
                <input
                  type="date"
                  className="input w-full"
                  value={duePostponed}
                  onChange={(e) => setDuePostponed(e.target.value)}
                  title="Перенос срока — исходный срок остаётся слева"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Приоритет">
                <select
                  className="input w-full"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                >
                  {TASK_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Статус">
                <select
                  className="input w-full"
                  value={status}
                  onChange={(e) => changeStatus(e.target.value)}
                >
                  {SINGLE_TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Completed At">
                <input
                  type="date"
                  className="input w-full"
                  value={completedAt}
                  onChange={(e) => setCompletedAt(e.target.value)}
                  disabled={!status.startsWith("Completed")}
                  title={
                    status.startsWith("Completed")
                      ? "Дата фактического выполнения"
                      : "Доступно, когда статус «Completed …»"
                  }
                />
              </Field>
              <Field label="Состояние">
                <div className="input w-full flex items-center bg-gray-50">
                  {closed ? (
                    <span className="text-green-700 font-medium">✓ закрыта</span>
                  ) : (
                    <span className="text-gray-500">открыта</span>
                  )}
                </div>
              </Field>
            </div>

            {error && <div className="text-sm text-red-600">{error}</div>}

            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-secondary" onClick={onClose} disabled={saving}>
                Отмена
              </button>
              <button className="btn-primary" onClick={save} disabled={saving}>
                {saving ? "Сохраняю…" : "Добавить задачу"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-gray-500 block">{label}</label>
      {children}
    </div>
  );
}
