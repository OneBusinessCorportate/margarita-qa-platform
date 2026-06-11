"use client";

import { useMemo, useState } from "react";
import {
  DAILY_CRITERIA,
  MONTHLY_CATEGORIES,
  PREV_STATUS_DEFAULT,
  computeOverall,
  type CriteriaScores,
  type CriterionId,
} from "@/lib/scoring";
import type { Accountant, Chat, Evaluation, MonthlyStatus } from "@/lib/types";
import { buildScoreMessage } from "@/lib/templates";
import BandChip from "./BandChip";
import CopyButton from "./CopyButton";

const today = () => new Date().toISOString().slice(0, 10);

interface Draft {
  chat_agr_no: string;
  accountant: string;
  checking_date: string;
  criteria: CriteriaScores;
  monthly: Record<string, MonthlyStatus>;
  comment: string;
  overrideTotal: string; // "" = auto
}

function emptyMonthly(): Record<string, MonthlyStatus> {
  const m: Record<string, MonthlyStatus> = {};
  for (const c of MONTHLY_CATEGORIES) m[c.id] = { status: "", prev: PREV_STATUS_DEFAULT };
  return m;
}

function blankDraft(): Draft {
  return {
    chat_agr_no: "",
    accountant: "",
    checking_date: today(),
    criteria: {},
    monthly: emptyMonthly(),
    comment: "",
    overrideTotal: "",
  };
}

function draftFromEval(ev: Evaluation): Draft {
  return {
    chat_agr_no: ev.chat_agr_no,
    accountant: ev.accountant ?? "",
    checking_date: ev.checking_date,
    criteria: ev.scores.criteria ?? {},
    monthly: { ...emptyMonthly(), ...(ev.scores.monthly ?? {}) },
    comment: ev.comment ?? "",
    overrideTotal: "",
  };
}

function draftTotal(d: Draft): number {
  if (d.overrideTotal.trim() !== "" && !Number.isNaN(Number(d.overrideTotal))) {
    return Number(d.overrideTotal);
  }
  return computeOverall(d.criteria);
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft | null>(null);
  const [newDraft, setNewDraft] = useState<Draft>(blankDraft());
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chatMap = useMemo(() => new Map(chats.map((c) => [c.agr_no, c])), [chats]);
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

  async function persist(d: Draft, id: string | null) {
    if (!d.chat_agr_no) {
      setError("Выберите чат");
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      chat_agr_no: d.chat_agr_no,
      checking_date: d.checking_date,
      accountant: d.accountant || null,
      scores: { criteria: d.criteria, monthly: d.monthly },
      comment: d.comment || null,
      total_override:
        d.overrideTotal.trim() !== "" ? Number(d.overrideTotal) : null,
    };
    try {
      const res = await fetch(
        id ? `/api/evaluations/${id}` : "/api/evaluations",
        {
          method: id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
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
      if (id) {
        setEditingId(null);
        setEditDraft(null);
      } else {
        setNewDraft(blankDraft()); // new blank row appears below
      }
    } catch {
      setError("Сетевая ошибка");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="card p-3 flex flex-wrap items-end gap-3">
        <div className="space-y-1 grow min-w-[240px]">
          <label className="text-xs text-gray-500">
            Поиск чата (№ договора / название) — фильтрует выпадающий список ниже
          </label>
          <input
            className="input w-full"
            placeholder="напр. 59, B-3302 или Фролкин"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <p className="text-xs text-gray-500 max-w-md">
          Новая оценка вводится в нижней строке таблицы. Выберите № договора —
          остальные данные подтянутся. После сохранения появится новая пустая
          строка. Любую строку можно отредактировать.
        </p>
      </div>

      {error && <div className="text-sm text-red-600 px-1">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="qa">
          <thead>
            <tr>
              <th className="min-w-[220px]">№ / Чат / Бухгалтер</th>
              <th>Дата</th>
              {DAILY_CRITERIA.map((c) => (
                <th key={c.id} title={c.name}>
                  {c.id === "accuracy" ? "Точность" : "СЛА"}
                </th>
              ))}
              {MONTHLY_CATEGORIES.map((c) => (
                <th key={c.id} title={c.name}>
                  {c.shortName}
                </th>
              ))}
              <th>Общая</th>
              <th>Качество</th>
              <th className="min-w-[160px]">Комментарий</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {evaluations.map((ev) =>
              editingId === ev.id && editDraft ? (
                <EditableRow
                  key={ev.id}
                  draft={editDraft}
                  setDraft={setEditDraft as (d: Draft) => void}
                  chats={chats}
                  filteredChats={filteredChats}
                  chatMap={chatMap}
                  accountants={accountants}
                  saving={saving}
                  fixedChat
                  onSave={() => persist(editDraft, ev.id)}
                  onCancel={() => {
                    setEditingId(null);
                    setEditDraft(null);
                  }}
                />
              ) : (
                <DisplayRow
                  key={ev.id}
                  ev={ev}
                  chat={chatMap.get(ev.chat_agr_no) ?? null}
                  onEdit={() => {
                    setEditingId(ev.id);
                    setEditDraft(draftFromEval(ev));
                  }}
                />
              )
            )}
            {/* New blank row */}
            <EditableRow
              draft={newDraft}
              setDraft={setNewDraft}
              chats={chats}
              filteredChats={filteredChats}
              chatMap={chatMap}
              accountants={accountants}
              saving={saving}
              isNew
              onSave={() => persist(newDraft, null)}
              onCancel={() => setNewDraft(blankDraft())}
            />
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DisplayRow({
  ev,
  chat,
  onEdit,
}: {
  ev: Evaluation;
  chat: Chat | null;
  onEdit: () => void;
}) {
  const monthly = ev.scores.monthly ?? {};
  return (
    <tr>
      <td>
        <div className="font-medium">№ {ev.chat_agr_no}</div>
        <div className="text-gray-500 text-xs">{chat?.chat_name ?? "—"}</div>
        <div className="text-gray-400 text-xs">{ev.accountant ?? "—"}</div>
      </td>
      <td className="whitespace-nowrap">{ev.checking_date}</td>
      {DAILY_CRITERIA.map((c) => (
        <td key={c.id} className="tabular-nums text-center">
          {ev.scores.criteria?.[c.id] ?? "—"}
        </td>
      ))}
      {MONTHLY_CATEGORIES.map((c) => (
        <td key={c.id} className="text-xs whitespace-nowrap">
          {monthly[c.id]?.status || "—"}
        </td>
      ))}
      <td className="tabular-nums font-semibold text-center">{ev.total_score}</td>
      <td>
        <BandChip band={ev.quality_band} />
      </td>
      <td className="text-xs text-gray-600">{ev.comment}</td>
      <td className="whitespace-nowrap">
        <div className="flex gap-1">
          <button className="btn-secondary" onClick={onEdit}>
            Изм.
          </button>
          <CopyButton label="Копир." text={buildScoreMessage(ev, chat)} />
        </div>
      </td>
    </tr>
  );
}

function EditableRow({
  draft,
  setDraft,
  chats,
  filteredChats,
  chatMap,
  accountants,
  saving,
  isNew,
  fixedChat,
  onSave,
  onCancel,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  chats: Chat[];
  filteredChats: Chat[];
  chatMap: Map<string, Chat>;
  accountants: Accountant[];
  saving: boolean;
  isNew?: boolean;
  fixedChat?: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const chat = draft.chat_agr_no ? chatMap.get(draft.chat_agr_no) : null;
  const total = draftTotal(draft);

  function pickChat(agrNo: string) {
    const c = chatMap.get(agrNo);
    setDraft({
      ...draft,
      chat_agr_no: agrNo,
      accountant: c?.accountant ?? draft.accountant,
    });
  }
  const setCrit = (id: CriterionId, v: string) =>
    setDraft({
      ...draft,
      criteria: { ...draft.criteria, [id]: v === "" ? undefined : Number(v) },
    });
  const setMonthly = (id: string, patch: Partial<MonthlyStatus>) =>
    setDraft({
      ...draft,
      monthly: { ...draft.monthly, [id]: { ...draft.monthly[id], ...patch } },
    });

  return (
    <tr className={isNew ? "bg-blue-50/40" : "bg-yellow-50/40"}>
      <td className="space-y-1">
        {fixedChat ? (
          <>
            <div className="font-medium">№ {draft.chat_agr_no}</div>
            <div className="text-gray-500 text-xs">{chat?.chat_name ?? ""}</div>
          </>
        ) : (
          <select
            className="input w-full"
            value={draft.chat_agr_no}
            onChange={(e) => pickChat(e.target.value)}
          >
            <option value="">— выберите чат —</option>
            {filteredChats.map((c) => (
              <option key={c.agr_no} value={c.agr_no}>
                № {c.agr_no} — {c.chat_name}
              </option>
            ))}
          </select>
        )}
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
        {chat && (
          <div className="text-xs text-gray-400">
            Долги: {chat.debts ?? "—"}
            {chat.chat_link && (
              <>
                {" · "}
                <a
                  href={chat.chat_link}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  чат
                </a>
              </>
            )}
          </div>
        )}
      </td>
      <td>
        <input
          type="date"
          className="input w-[130px]"
          value={draft.checking_date}
          onChange={(e) => setDraft({ ...draft, checking_date: e.target.value })}
        />
      </td>
      {DAILY_CRITERIA.map((c) => (
        <td key={c.id}>
          <select
            className="input w-[56px]"
            value={draft.criteria[c.id] ?? ""}
            onChange={(e) => setCrit(c.id, e.target.value)}
            title={c.name}
          >
            <option value="">—</option>
            {Array.from({ length: c.scaleMax + 1 }, (_, i) => i).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </td>
      ))}
      {MONTHLY_CATEGORIES.map((c) => (
        <td key={c.id}>
          <select
            className="input w-[130px] text-xs"
            value={draft.monthly[c.id]?.status ?? ""}
            onChange={(e) => setMonthly(c.id, { status: e.target.value })}
            title={c.name}
          >
            <option value="">—</option>
            {c.statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </td>
      ))}
      <td>
        <input
          className="input w-[64px] tabular-nums text-center"
          value={draft.overrideTotal === "" ? total : draft.overrideTotal}
          onChange={(e) => setDraft({ ...draft, overrideTotal: e.target.value })}
          title="Авто из критериев; можно переопределить"
        />
      </td>
      <td>
        <BandChip total={total} />
      </td>
      <td>
        <input
          className="input w-full"
          value={draft.comment}
          onChange={(e) => setDraft({ ...draft, comment: e.target.value })}
          placeholder="комментарий…"
        />
      </td>
      <td className="whitespace-nowrap">
        <div className="flex gap-1">
          <button
            className="btn-primary"
            onClick={onSave}
            disabled={saving || !draft.chat_agr_no}
          >
            {saving ? "…" : isNew ? "Добавить" : "Сохр."}
          </button>
          {!isNew && (
            <button className="btn-secondary" onClick={onCancel}>
              Отм.
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
