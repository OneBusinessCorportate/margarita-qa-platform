"use client";

import { useMemo, useState } from "react";
import {
  CRITERIA,
  bandFor,
  computeWeightedTotal,
  type CriteriaScores,
  type CriterionId,
} from "@/lib/scoring";
import type { Accountant, Chat, Evaluation } from "@/lib/types";
import { buildScoreMessage } from "@/lib/templates";
import BandChip from "./BandChip";
import CopyButton from "./CopyButton";

const today = () => new Date().toISOString().slice(0, 10);
const emptyScores = (): CriteriaScores => ({});

interface FormState {
  editingId: string | null;
  chat_agr_no: string;
  accountant: string;
  checking_date: string;
  scores: CriteriaScores;
  comment: string;
}

function blankForm(): FormState {
  return {
    editingId: null,
    chat_agr_no: "",
    accountant: "",
    checking_date: today(),
    scores: emptyScores(),
    comment: "",
  };
}

export default function ScoringPanel({
  chats,
  accountants,
  initialEvaluations,
}: {
  chats: Chat[];
  accountants: Accountant[];
  initialEvaluations: Evaluation[];
}) {
  const [evaluations, setEvaluations] = useState<Evaluation[]>(initialEvaluations);
  const [form, setForm] = useState<FormState>(blankForm());
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chatMap = useMemo(
    () => new Map(chats.map((c) => [c.agr_no, c])),
    [chats]
  );
  const selectedChat = form.chat_agr_no ? chatMap.get(form.chat_agr_no) : null;

  const filteredChats = useMemo(() => {
    const n = search.trim().toLowerCase();
    if (!n) return chats;
    return chats.filter(
      (c) =>
        c.agr_no.toLowerCase().includes(n) ||
        c.chat_name.toLowerCase().includes(n) ||
        (c.name_agr ?? "").toLowerCase().includes(n)
    );
  }, [chats, search]);

  const total = computeWeightedTotal(form.scores);
  const band = bandFor(total);

  function pickChat(agrNo: string) {
    const chat = chatMap.get(agrNo);
    setForm((f) => ({
      ...f,
      chat_agr_no: agrNo,
      // Default the responsible accountant from the chat if not editing.
      accountant: f.editingId ? f.accountant : chat?.accountant ?? "",
    }));
  }

  function setScore(id: CriterionId, value: number | undefined) {
    setForm((f) => ({ ...f, scores: { ...f.scores, [id]: value } }));
  }

  function resetForm() {
    setForm(blankForm());
    setError(null);
  }

  function loadForEdit(ev: Evaluation) {
    setForm({
      editingId: ev.id,
      chat_agr_no: ev.chat_agr_no,
      accountant: ev.accountant ?? "",
      checking_date: ev.checking_date,
      scores: ev.scores.criteria ?? {},
      comment: ev.comment ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save() {
    if (!form.chat_agr_no) {
      setError("Выберите чат");
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      chat_agr_no: form.chat_agr_no,
      checking_date: form.checking_date,
      accountant: form.accountant || null,
      scores: { criteria: form.scores },
      comment: form.comment || null,
    };
    try {
      const url = form.editingId
        ? `/api/evaluations/${form.editingId}`
        : "/api/evaluations";
      const method = form.editingId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Не удалось сохранить");
        return;
      }
      const saved: Evaluation = await res.json();
      setEvaluations((prev) => {
        const without = prev.filter((e) => e.id !== saved.id);
        return [saved, ...without];
      });
      // New blank row appears below after saving.
      resetForm();
    } catch {
      setError("Сетевая ошибка");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Form card */}
      <div className="card p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">
            {form.editingId ? "Редактирование оценки" : "Новая оценка"}
          </h2>
          {form.editingId && (
            <button className="btn-secondary" onClick={resetForm}>
              Отмена / новая
            </button>
          )}
        </div>

        {/* Chat picker */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1 md:col-span-2">
            <label className="text-sm text-gray-600">
              Поиск чата (№ договора или название)
            </label>
            <input
              className="input w-full"
              placeholder="напр. 59, B-3302 или ARM TRADE"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="input w-full"
              value={form.chat_agr_no}
              onChange={(e) => pickChat(e.target.value)}
            >
              <option value="">— выберите чат —</option>
              {filteredChats.map((c) => (
                <option key={c.agr_no} value={c.agr_no}>
                  № {c.agr_no} — {c.chat_name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm text-gray-600">Дата проверки</label>
            <input
              type="date"
              className="input w-full"
              value={form.checking_date}
              onChange={(e) =>
                setForm((f) => ({ ...f, checking_date: e.target.value }))
              }
            />
          </div>
        </div>

        {/* Selected chat metadata */}
        {selectedChat && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-sm bg-gray-50 rounded p-3">
            <Meta label="№ договора" value={selectedChat.agr_no} />
            <Meta label="Чат" value={selectedChat.chat_name} />
            <Meta
              label="Статус"
              value={selectedChat.status === "Active" ? "Активен" : "Неактивен"}
            />
            <Meta label="Долги" value={selectedChat.debts ?? "—"} />
            <Meta label="Менеджер" value={selectedChat.manager ?? "—"} />
            <Meta
              label="Активация в налоговой"
              value={selectedChat.tax_activation_date ?? "—"}
            />
            <div className="col-span-2 md:col-span-2">
              <div className="text-xs text-gray-500">Ссылка на чат</div>
              {selectedChat.chat_link ? (
                <a
                  href={selectedChat.chat_link}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 hover:underline break-all"
                >
                  {selectedChat.chat_link}
                </a>
              ) : (
                <span>—</span>
              )}
            </div>
          </div>
        )}

        {/* Responsible accountant */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="text-sm text-gray-600">Ответственный (бухгалтер)</label>
            <select
              className="input w-full"
              value={form.accountant}
              onChange={(e) =>
                setForm((f) => ({ ...f, accountant: e.target.value }))
              }
            >
              <option value="">— не назначен —</option>
              {accountants.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.name}
                  {!a.active ? " (неактивен)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Criteria scoring */}
        <div className="space-y-2">
          <div className="text-sm font-medium text-gray-700">
            Критерии (0–5)
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {CRITERIA.map((c) => {
              const v = form.scores[c.id];
              return (
                <div key={c.id} className="border border-gray-200 rounded p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{c.name}</span>
                    <span className="text-xs text-gray-400">вес {c.weight}</span>
                  </div>
                  <select
                    className="input w-full mt-1"
                    value={v ?? ""}
                    onChange={(e) =>
                      setScore(
                        c.id,
                        e.target.value === "" ? undefined : Number(e.target.value)
                      )
                    }
                  >
                    <option value="">— нет оценки —</option>
                    {Array.from({ length: c.scaleMax + 1 }, (_, i) => i).map(
                      (n) => (
                        <option key={n} value={n}>
                          {n} — {c.descriptions[n]}
                        </option>
                      )
                    )}
                  </select>
                </div>
              );
            })}
          </div>
        </div>

        {/* Comment */}
        <div className="space-y-1">
          <label className="text-sm text-gray-600">Комментарий</label>
          <textarea
            className="input w-full"
            rows={2}
            value={form.comment}
            onChange={(e) =>
              setForm((f) => ({ ...f, comment: e.target.value }))
            }
            placeholder="Свободный комментарий к оценке…"
          />
        </div>

        {/* Total + actions */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">Итог:</span>
            <span className="text-2xl font-semibold tabular-nums">{total}</span>
            <span className="text-sm text-gray-400">/ 100</span>
            <BandChip total={total} />
          </div>
          <div className="flex items-center gap-2">
            {error && <span className="text-sm text-red-600">{error}</span>}
            <button
              className="btn-primary"
              onClick={save}
              disabled={saving || !form.chat_agr_no}
            >
              {saving
                ? "Сохранение…"
                : form.editingId
                ? "Сохранить изменения"
                : "Сохранить оценку"}
            </button>
          </div>
        </div>
      </div>

      {/* Recent evaluations table */}
      <div className="card overflow-x-auto">
        <table className="qa">
          <thead>
            <tr>
              <th>Дата</th>
              <th>№ / Чат</th>
              <th>Бухгалтер</th>
              <th>Оценка</th>
              <th>Качество</th>
              <th>Комментарий</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {evaluations.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-gray-400 py-6">
                  Пока нет оценок.
                </td>
              </tr>
            )}
            {evaluations.map((ev) => {
              const chat = chatMap.get(ev.chat_agr_no) ?? null;
              return (
                <tr key={ev.id}>
                  <td className="whitespace-nowrap">{ev.checking_date}</td>
                  <td>
                    <div className="font-medium">№ {ev.chat_agr_no}</div>
                    <div className="text-gray-500">{chat?.chat_name ?? "—"}</div>
                  </td>
                  <td>{ev.accountant ?? "—"}</td>
                  <td className="tabular-nums font-medium">{ev.total_score}</td>
                  <td>
                    <BandChip band={ev.quality_band} />
                  </td>
                  <td className="max-w-xs">
                    <span className="text-gray-600 line-clamp-2">
                      {ev.comment ?? ""}
                    </span>
                  </td>
                  <td className="whitespace-nowrap">
                    <div className="flex gap-1">
                      <button
                        className="btn-secondary"
                        onClick={() => loadForEdit(ev)}
                      >
                        Изм.
                      </button>
                      <CopyButton
                        label="Копир."
                        text={buildScoreMessage(ev, chat)}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="font-medium break-words">{value}</div>
    </div>
  );
}
