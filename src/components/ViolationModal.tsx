"use client";

import { useEffect, useState } from "react";
import {
  VIOLATION_SEVERITIES,
  violationTypeOptions,
} from "@/lib/violations";
import type { Violation } from "@/lib/types";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Log a нарушение without leaving the page (boss's request — "кнопка нарушения,
 * заполняем поля и уже уходит в другую вкладку"). Opens over the QA grid,
 * pre-filled from the chat row; on save it POSTs to /api/violations so the entry
 * lands in the Нарушения tab and the modal closes. This removes the round-trip
 * to the Нарушения page that slowed Margarita down (items 2, 5).
 */
export default function ViolationModal({
  chatAgrNo,
  client,
  accountant,
  defaultDate,
  onClose,
  onSaved,
}: {
  chatAgrNo: string | null;
  client: string | null;
  accountant: string | null;
  defaultDate?: string;
  onClose: () => void;
  onSaved?: (v: Violation) => void;
}) {
  const [vdate, setVdate] = useState(defaultDate ?? today());
  const [severity, setSeverity] = useState("Критичное");
  const [violationType, setViolationType] = useState("");
  const [sanction, setSanction] = useState("");
  const [note, setNote] = useState("");
  const [acc, setAcc] = useState(accountant ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Escape closes the modal — standard popup behaviour.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    if (!violationType.trim() && !severity) {
      setError("Укажите тип нарушения");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/violations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vdate,
          accountant: acc || null,
          chat_agr_no: chatAgrNo,
          client: client || null,
          severity: severity || null,
          violation_type: violationType || null,
          sanction: sanction === "" ? null : Number(sanction),
          note: note || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Не удалось сохранить");
        return;
      }
      const saved: Violation = await res.json();
      onSaved?.(saved);
      setDone(true);
      // Brief confirmation, then close — keeps QA in the flow.
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
        // Click on the backdrop (not the card) closes.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="card w-full max-w-md p-4 space-y-3 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">
            ⚠️ Нарушение
          </h2>
          <button
            className="text-gray-400 hover:text-gray-700 text-lg leading-none px-1"
            onClick={onClose}
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>

        <div className="text-xs text-gray-500">
          {client ?? chatAgrNo ?? "—"}
          {chatAgrNo && <span className="text-gray-400"> · № {chatAgrNo}</span>}
        </div>

        {done ? (
          <div className="py-6 text-center text-green-700 font-medium">
            ✓ Добавлено в «Нарушения»
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Дата">
                <input
                  type="date"
                  className="input w-full"
                  value={vdate}
                  onChange={(e) => setVdate(e.target.value)}
                />
              </Field>
              <Field label="Важность">
                <select
                  className="input w-full"
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value)}
                >
                  {VIOLATION_SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {s}
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

            <Field label="Тип нарушения">
              <input
                list="violation-modal-types"
                className="input w-full"
                placeholder="тип нарушения"
                value={violationType}
                onChange={(e) => setViolationType(e.target.value)}
              />
              <datalist id="violation-modal-types">
                {violationTypeOptions(severity).map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Санкция (драм)">
                <input
                  className="input w-full tabular-nums"
                  inputMode="numeric"
                  placeholder="0"
                  value={sanction}
                  onChange={(e) => setSanction(e.target.value)}
                />
              </Field>
            </div>

            <Field label="Комментарий">
              <input
                className="input w-full"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="примечание…"
              />
            </Field>

            {error && <div className="text-sm text-red-600">{error}</div>}

            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-secondary" onClick={onClose} disabled={saving}>
                Отмена
              </button>
              <button className="btn-primary" onClick={save} disabled={saving}>
                {saving ? "Сохраняю…" : "Добавить в нарушения"}
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
