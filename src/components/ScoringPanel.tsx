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
  const [date, setDate] = useState(today());
  const [search, setSearch] = useState("");
  const [accFilter, setAccFilter] = useState("");
  const [onlyUnscored, setOnlyUnscored] = useState(false);
  const [activeOnly, setActiveOnly] = useState(true);

  // Today's evaluations indexed by chat for the selected date.
  const evalForDate = useMemo(() => {
    const m = new Map<string, Evaluation>();
    for (const e of evaluations) {
      if (e.checking_date.slice(0, 10) === date) m.set(e.chat_agr_no, e);
    }
    return m;
  }, [evaluations, date]);

  const visibleChats = useMemo(() => {
    const n = search.trim().toLowerCase();
    return chats.filter((c) => {
      if (activeOnly && c.status !== "Active") return false;
      if (accFilter && c.accountant !== accFilter) return false;
      if (onlyUnscored && evalForDate.has(c.agr_no)) return false;
      if (
        n &&
        !c.agr_no.toLowerCase().includes(n) &&
        !c.chat_name.toLowerCase().includes(n) &&
        !(c.name_agr ?? "").toLowerCase().includes(n)
      )
        return false;
      return true;
    });
  }, [chats, search, accFilter, onlyUnscored, activeOnly, evalForDate]);

  const scoredToday = chats.filter((c) => evalForDate.has(c.agr_no)).length;
  const activeCount = chats.filter((c) => c.status === "Active").length;

  function onSaved(saved: Evaluation) {
    setEvaluations((prev) => [saved, ...prev.filter((e) => e.id !== saved.id)]);
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="card p-3 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs text-gray-500 block">Дата проверки</label>
          <input
            type="date"
            className="input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="space-y-1 grow min-w-[200px]">
          <label className="text-xs text-gray-500 block">Поиск чата (№ / название)</label>
          <input
            className="input w-full"
            placeholder="напр. 59 или Фролкин"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-gray-500 block">Бухгалтер</label>
          <select
            className="input"
            value={accFilter}
            onChange={(e) => setAccFilter(e.target.value)}
          >
            <option value="">Все</option>
            {accountants.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-1.5 text-sm text-gray-600 pb-1.5">
          <input
            type="checkbox"
            checked={onlyUnscored}
            onChange={(e) => setOnlyUnscored(e.target.checked)}
          />
          Только неоценённые
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-600 pb-1.5">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
          />
          Только активные
        </label>
      </div>

      {/* Summary */}
      <div className="flex flex-wrap gap-2 text-sm">
        <Stat label="Активных чатов" value={activeCount} />
        <Stat label="Оценено за день" value={scoredToday} />
        <Stat label="Показано" value={visibleChats.length} />
      </div>

      <p className="text-xs text-gray-500 px-1">
        Откройте чат по ссылке, проверьте коммуникацию и проставьте оценку прямо
        в строке. Если чата нет в списке — снимите фильтры или найдите его
        поиском. Сохранённые оценки можно редактировать.
      </p>

      <div className="card overflow-x-auto">
        <table className="qa">
          <thead>
            <tr>
              <th className="min-w-[230px]">№ / Чат / Бухгалтер</th>
              <th>Чат</th>
              <th title="Предварительная оценка от бота — появится позже">Предв. (бот)</th>
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
              <th className="min-w-[150px]">Комментарий</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibleChats.length === 0 && (
              <tr>
                <td colSpan={14} className="text-center text-gray-400 py-6">
                  Нет чатов по текущим фильтрам.
                </td>
              </tr>
            )}
            {visibleChats.map((chat) => (
              <ChatScoreRow
                key={`${chat.agr_no}|${date}`}
                chat={chat}
                accountants={accountants}
                date={date}
                existing={evalForDate.get(chat.agr_no) ?? null}
                onSaved={onSaved}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card px-3 py-1.5">
      <span className="text-gray-500">{label}: </span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function emptyMonthly(): Record<string, MonthlyStatus> {
  const m: Record<string, MonthlyStatus> = {};
  for (const c of MONTHLY_CATEGORIES) m[c.id] = { status: "", prev: PREV_STATUS_DEFAULT };
  return m;
}

function ChatScoreRow({
  chat,
  accountants,
  date,
  existing,
  onSaved,
}: {
  chat: Chat;
  accountants: Accountant[];
  date: string;
  existing: Evaluation | null;
  onSaved: (e: Evaluation) => void;
}) {
  const [accountant, setAccountant] = useState(
    existing?.accountant ?? chat.accountant ?? ""
  );
  const [criteria, setCriteria] = useState<CriteriaScores>(
    existing?.scores.criteria ?? {}
  );
  const [monthly, setMonthly] = useState<Record<string, MonthlyStatus>>({
    ...emptyMonthly(),
    ...(existing?.scores.monthly ?? {}),
  });
  const [comment, setComment] = useState(existing?.comment ?? "");
  const [override, setOverride] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(existing?.id ?? null);

  const total =
    override.trim() !== "" && !Number.isNaN(Number(override))
      ? Number(override)
      : computeOverall(criteria, monthly);

  const setCrit = (id: CriterionId, v: string) =>
    setCriteria((c) => ({ ...c, [id]: v === "" ? undefined : Number(v) }));
  const setMon = (id: string, status: string) =>
    setMonthly((m) => ({ ...m, [id]: { ...m[id], status } }));

  async function save() {
    setSaving(true);
    setError(null);
    const payload = {
      chat_agr_no: chat.agr_no,
      checking_date: date,
      accountant: accountant || null,
      scores: { criteria, monthly },
      comment: comment || null,
      total_override: override.trim() !== "" ? Number(override) : null,
    };
    try {
      const res = await fetch(
        savedId ? `/api/evaluations/${savedId}` : "/api/evaluations",
        {
          method: savedId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Ошибка");
        return;
      }
      const saved: Evaluation = await res.json();
      setSavedId(saved.id);
      onSaved(saved);
    } catch {
      setError("Сеть");
    } finally {
      setSaving(false);
    }
  }

  const previewEval: Evaluation = {
    id: savedId ?? "preview",
    chat_agr_no: chat.agr_no,
    period: date.slice(0, 7).replace("-", ""),
    checking_date: date,
    accountant: accountant || null,
    scores: { criteria, monthly },
    total_score: total,
    quality_band: "Критично",
    comment: comment || null,
    created_at: new Date().toISOString(),
  };

  return (
    <tr className={savedId ? "" : "bg-blue-50/30"}>
      <td className="space-y-1">
        <div className="font-medium">
          № {chat.agr_no}
          {chat.status !== "Active" && (
            <span className="ml-1 text-xs text-gray-400">(неактивен)</span>
          )}
        </div>
        <div className="text-gray-600 text-xs">{chat.chat_name}</div>
        <select
          className="input w-full text-xs"
          value={accountant}
          onChange={(e) => setAccountant(e.target.value)}
        >
          <option value="">— бухгалтер —</option>
          {accountants.map((a) => (
            <option key={a.name} value={a.name}>
              {a.name}
            </option>
          ))}
        </select>
        <div className="text-xs text-gray-400">
          Долги: {chat.debts ?? "—"} · Менеджер: {chat.manager ?? "—"}
        </div>
      </td>
      <td>
        {chat.chat_link ? (
          <a
            href={chat.chat_link}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary whitespace-nowrap"
            title="Открыть чат в Telegram"
          >
            Открыть ↗
          </a>
        ) : (
          <span className="text-gray-400 text-xs">нет ссылки</span>
        )}
      </td>
      {/* Preliminary bot score — TODO(margarita): wire to bot. */}
      <td className="text-center text-gray-300">—</td>
      {DAILY_CRITERIA.map((c) => (
        <td key={c.id}>
          <select
            className="input w-[52px]"
            value={criteria[c.id] ?? ""}
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
            className="input w-[120px] text-xs"
            value={monthly[c.id]?.status ?? ""}
            onChange={(e) => setMon(c.id, e.target.value)}
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
          className="input w-[60px] tabular-nums text-center"
          value={override === "" ? total : override}
          onChange={(e) => setOverride(e.target.value)}
          title="Авто из критериев; можно переопределить"
        />
      </td>
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
      <td className="whitespace-nowrap">
        <div className="flex flex-col gap-1">
          <div className="flex gap-1">
            <button className="btn-primary" onClick={save} disabled={saving}>
              {saving ? "…" : savedId ? "Сохр." : "Оценить"}
            </button>
            <CopyButton label="Копир." text={buildScoreMessage(previewEval, chat)} />
          </div>
          {savedId && <span className="text-[10px] text-green-600">сохранено ✓</span>}
          {error && <span className="text-[10px] text-red-600">{error}</span>}
        </div>
      </td>
    </tr>
  );
}
