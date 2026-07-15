"use client";

import { useEffect, useState } from "react";
import { TASK_PRIORITIES } from "@/lib/scoring";
import type { Task } from "@/lib/types";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Add a task without leaving the scoring page — mirrors ViolationModal.
 * Pre-filled from the chat row; on save POSTs to /api/tasks.
 */
export default function TaskModal({
  chatAgrNo,
  client,
  accountant,
  defaultDate,
  onClose,
  onSaved,
}: {
  chatAgrNo: string;
  client: string | null;
  accountant: string | null;
  defaultDate?: string;
  onClose: () => void;
  onSaved?: (t: Task) => void;
}) {
  const [dueDate, setDueDate] = useState(defaultDate ?? today());
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [acc, setAcc] = useState(accountant ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
          description: description || null,
          due_date_original: dueDate || null,
          priority,
          task_status: "-",
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
              <Field label="Срок">
                <input
                  type="date"
                  className="input w-full"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </Field>
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
            </div>

            <Field label="Бухгалтер">
              <input
                className="input w-full"
                value={acc}
                onChange={(e) => setAcc(e.target.value)}
                placeholder="имя бухгалтера"
              />
            </Field>

            <Field label="Описание задачи">
              <input
                className="input w-full"
                placeholder="напр. «вернётся с ответом через 2 дня»"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>

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
