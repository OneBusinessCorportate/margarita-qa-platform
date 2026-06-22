"use client";

import { useMemo, useState } from "react";
import {
  REGISTRATION_PENALTIES,
  REGISTRATION_START,
  computeRegistrationScore,
  isoWeekLabel,
  mondayOf,
} from "@/lib/scoring";
import type { ManagerEvaluation } from "@/lib/types";
import BandChip from "./BandChip";

const today = () => new Date().toISOString().slice(0, 10);

type Counts = Record<string, number>;

function countsOf(e: ManagerEvaluation): Counts {
  return { ...(e.scores?.registration ?? {}) };
}

export default function RegistrationPanel({
  managers,
  initialEvaluations,
}: {
  managers: string[];
  initialEvaluations: ManagerEvaluation[];
}) {
  const [rows, setRows] = useState<ManagerEvaluation[]>(initialEvaluations);
  const [fManager, setFManager] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (fManager && r.manager !== fManager) return false;
        if (fFrom && r.week_start < mondayOf(fFrom)) return false;
        if (fTo && r.week_start > mondayOf(fTo)) return false;
        return true;
      }),
    [rows, fManager, fFrom, fTo]
  );

  function onSaved(saved: ManagerEvaluation) {
    setRows((prev) => [saved, ...prev.filter((r) => r.id !== saved.id)]);
  }

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="card p-3 flex flex-wrap items-end gap-3">
        <Field label="Менеджер">
          <select
            className="input"
            value={fManager}
            onChange={(e) => setFManager(e.target.value)}
          >
            <option value="">Все</option>
            {managers.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        <Field label="С недели">
          <input
            type="date"
            className="input"
            value={fFrom}
            onChange={(e) => setFFrom(e.target.value)}
          />
        </Field>
        <Field label="По неделю">
          <input
            type="date"
            className="input"
            value={fTo}
            onChange={(e) => setFTo(e.target.value)}
          />
        </Field>
        <button
          className="btn-secondary"
          onClick={() => {
            setFManager("");
            setFFrom("");
            setFTo("");
          }}
        >
          Сброс
        </button>
        <span className="text-xs text-gray-400 pb-1.5">
          Показано: {filtered.length}
        </span>
      </div>

      <div className="card overflow-x-auto">
        <table className="qa">
          <thead>
            <tr>
              <th className="min-w-[150px]">Неделя</th>
              <th className="min-w-[150px]">Менеджер</th>
              {REGISTRATION_PENALTIES.map((p) => (
                <th key={p.id} className="text-center" title={`${p.name} (${p.points})`}>
                  {shortName(p.id)}
                  <div className="text-[10px] font-normal text-gray-400">{p.points}</div>
                </th>
              ))}
              <th className="text-center">Оценка</th>
              <th>Качество</th>
              <th className="min-w-[160px]">Комментарий</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <RegEvalRow
                key={e.id}
                managers={managers}
                existing={e}
                onSaved={onSaved}
              />
            ))}
            <RegEvalRow managers={managers} existing={null} onSaved={onSaved} />
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 px-1">
        Старт {REGISTRATION_START} баллов, минус штрафы за каждый случай. Одна
        оценка на менеджера в неделю — повторное сохранение обновляет строку.
      </p>
    </div>
  );
}

function shortName(id: string): string {
  switch (id) {
    case "critical":
      return "Крит.";
    case "speed":
      return "Скор.";
    case "feedback":
      return "ОС";
    default:
      return id;
  }
}

function RegEvalRow({
  managers,
  existing,
  onSaved,
}: {
  managers: string[];
  existing: ManagerEvaluation | null;
  onSaved: (e: ManagerEvaluation) => void;
}) {
  const isNew = existing === null;
  const [manager, setManager] = useState(existing?.manager ?? "");
  const [week, setWeek] = useState(existing?.week_start ?? mondayOf(today()));
  const [counts, setCounts] = useState<Counts>(existing ? countsOf(existing) : {});
  const [comment, setComment] = useState(existing?.comment ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(existing?.id ?? null);
  const [ok, setOk] = useState(false);

  const total = computeRegistrationScore(counts);
  const weekStart = mondayOf(week);

  const setCount = (id: string, v: string) =>
    setCounts((c) => ({ ...c, [id]: v === "" ? 0 : Math.max(0, Number(v)) }));

  async function save() {
    if (!manager.trim()) {
      setError("Менеджер");
      return;
    }
    setSaving(true);
    setError(null);
    setOk(false);
    try {
      const res = await fetch(
        savedId ? `/api/manager-evaluations/${savedId}` : "/api/manager-evaluations",
        {
          method: savedId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            manager: manager.trim(),
            week_start: weekStart,
            scores: { registration: counts },
            comment: comment || null,
          }),
        }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Ошибка");
        return;
      }
      const saved: ManagerEvaluation = await res.json();
      onSaved(saved);
      setOk(true);
      if (isNew) {
        // Reset the entry row for the next manager.
        setManager("");
        setCounts({});
        setComment("");
        setSavedId(null);
      } else {
        setSavedId(saved.id);
      }
    } catch {
      setError("Сеть");
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className={isNew ? "bg-blue-50/40" : ""}>
      <td>
        <input
          type="date"
          className="input w-[140px]"
          value={week}
          onChange={(e) => setWeek(e.target.value)}
        />
        <div className="text-[10px] text-gray-400 mt-0.5">
          {isoWeekLabel(weekStart)} · с {weekStart}
        </div>
      </td>
      <td>
        <input
          list="reg-managers"
          className="input w-full"
          placeholder="менеджер"
          value={manager}
          onChange={(e) => setManager(e.target.value)}
        />
        <datalist id="reg-managers">
          {managers.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </td>
      {REGISTRATION_PENALTIES.map((p) => (
        <td key={p.id} className="text-center">
          <input
            type="number"
            min={0}
            className="input w-[52px] text-center"
            placeholder="0"
            value={counts[p.id] ?? ""}
            onChange={(e) => setCount(p.id, e.target.value)}
            title={p.name}
          />
        </td>
      ))}
      <td className="text-center tabular-nums font-semibold">{total}</td>
      <td>
        <BandChip total={total} />
      </td>
      <td>
        <input
          className="input w-full"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="комментарий…"
        />
      </td>
      <td className="whitespace-nowrap text-right">
        <button className="btn-primary !px-3 !py-1 text-xs" onClick={save} disabled={saving}>
          {saving ? "…" : isNew ? "Добавить" : "Сохр."}
        </button>
        {ok && <span className="ml-1 text-[10px] text-green-600">✓</span>}
        {error && <span className="ml-1 text-[10px] text-red-600">{error}</span>}
      </td>
    </tr>
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
