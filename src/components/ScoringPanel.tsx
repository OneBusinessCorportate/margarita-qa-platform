"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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

/** Open all chat links in ONE reused Telegram tab — switching chats just
 * changes the hash, so Telegram Web stays loaded (no 7s reload each time). */
const TG_WINDOW = "telegram_chat";

type Scope = "day" | "all";

export default function ScoringPanel({
  chats,
  accountants,
  initialEvaluations,
  taskActivity = [],
  latestActivityDate = null,
}: {
  chats: Chat[];
  accountants: Accountant[];
  initialEvaluations: Evaluation[];
  taskActivity?: { chat_agr_no: string; date: string }[];
  latestActivityDate?: string | null;
}) {
  const router = useRouter();
  const [evaluations, setEvaluations] = useState<Evaluation[]>(initialEvaluations);
  const [date, setDate] = useState(latestActivityDate ?? today());
  const [scope, setScope] = useState<Scope>("all");
  const [search, setSearch] = useState("");
  const [accFilter, setAccFilter] = useState("");
  const [onlyUnscored, setOnlyUnscored] = useState(false);
  const [activeOnly, setActiveOnly] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);

  // Refresh the chat/eval data every 40 minutes (item 5). With the bot feed
  // wired in, this is how "Активные за день" stays current through the day.
  useEffect(() => {
    const id = setInterval(() => {
      router.refresh();
      setRefreshedAt(new Date().toLocaleTimeString("ru-RU"));
    }, 40 * 60 * 1000);
    return () => clearInterval(id);
  }, [router]);

  // Previous status per chat per mailing = the status at the most recent
  // evaluation BEFORE the selected date (item 6).
  const prevByChat = useMemo(() => {
    const latestBefore = new Map<string, Evaluation>();
    for (const e of evaluations) {
      if (e.checking_date.slice(0, 10) >= date) continue;
      const cur = latestBefore.get(e.chat_agr_no);
      if (!cur || e.checking_date > cur.checking_date) latestBefore.set(e.chat_agr_no, e);
    }
    const out = new Map<string, Record<string, string>>();
    for (const [chatNo, e] of latestBefore) {
      const rec: Record<string, string> = {};
      for (const cat of MONTHLY_CATEGORIES) {
        const s = e.scores.monthly?.[cat.id]?.status;
        if (s) rec[cat.id] = s;
      }
      out.set(chatNo, rec);
    }
    return out;
  }, [evaluations, date]);

  // Today's evaluations indexed by chat for the selected date.
  const evalForDate = useMemo(() => {
    const m = new Map<string, Evaluation>();
    for (const e of evaluations) {
      if (e.checking_date.slice(0, 10) === date) m.set(e.chat_agr_no, e);
    }
    return m;
  }, [evaluations, date]);

  // Chats with activity on the selected date: an evaluation or a task that day.
  // TODO(margarita): expand with the bot's daily "chats with messages" feed.
  const activeTodaySet = useMemo(() => {
    const s = new Set<string>(evalForDate.keys());
    for (const t of taskActivity) if (t.date === date) s.add(t.chat_agr_no);
    return s;
  }, [evalForDate, taskActivity, date]);

  const visibleChats = useMemo(() => {
    const n = search.trim().toLowerCase();
    return chats.filter((c) => {
      if (scope === "day" && !activeTodaySet.has(c.agr_no)) return false;
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
  }, [chats, search, accFilter, onlyUnscored, activeOnly, evalForDate, scope, activeTodaySet]);

  const scoredToday = chats.filter((c) => evalForDate.has(c.agr_no)).length;
  const activeCount = chats.filter((c) => c.status === "Active").length;
  const activeTodayCount = chats.filter(
    (c) => c.status === "Active" && activeTodaySet.has(c.agr_no)
  ).length;

  function onSaved(saved: Evaluation) {
    setEvaluations((prev) => [saved, ...prev.filter((e) => e.id !== saved.id)]);
  }

  return (
    <div className="space-y-3">
      {/* Scope toggle */}
      <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden text-sm">
        <button
          onClick={() => setScope("day")}
          className={`px-3 py-1.5 font-medium ${
            scope === "day" ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"
          }`}
        >
          Активные за день
        </button>
        <button
          onClick={() => setScope("all")}
          className={`px-3 py-1.5 font-medium border-l border-gray-300 ${
            scope === "all" ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"
          }`}
        >
          Все активные чаты
        </button>
      </div>

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
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Stat label="Активных чатов (всего)" value={activeCount} />
        <Stat label="Активных за день" value={activeTodayCount} />
        <Stat label="Оценено за день" value={scoredToday} />
        <Stat label="Показано" value={visibleChats.length} />
        <button
          className="btn-secondary"
          onClick={() => {
            router.refresh();
            setRefreshedAt(new Date().toLocaleTimeString("ru-RU"));
          }}
          title="Список обновляется автоматически каждые 40 минут"
        >
          Обновить ⟳
        </button>
        {refreshedAt && (
          <span className="text-xs text-gray-400">обновлено в {refreshedAt}</span>
        )}
      </div>

      <p className="text-xs text-gray-500 px-1">
        {scope === "day"
          ? "Режим «за день»: показаны чаты с активностью за выбранную дату (оценки/задачи; позже — данные бота). Это быстрее для ежедневной проверки. Чтобы оценить любой другой чат — переключитесь на «Все активные чаты»."
          : "Режим «все активные»: показаны все активные чаты. Откройте чат по ссылке, проверьте коммуникацию и проставьте оценку прямо в строке. Сохранённые оценки можно редактировать."}
      </p>

      <div className="card overflow-x-auto">
        <table className="qa">
          <thead>
            <tr>
              <th className="sticky left-0 z-20 bg-gray-100 min-w-[210px]">
                № / Чат / Бухгалтер
              </th>
              {DAILY_CRITERIA.map((c) => (
                <th key={c.id} title={c.name}>
                  {c.id === "accuracy" ? "Точн." : "СЛА"}
                </th>
              ))}
              {MONTHLY_CATEGORIES.map((c) => (
                <th key={c.id} title={c.name}>
                  {c.shortName}
                </th>
              ))}
              <th>Общая</th>
              <th>Кач-во</th>
              <th className="min-w-[140px]">Комментарий</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibleChats.length === 0 && (
              <tr>
                <td colSpan={11} className="text-center text-gray-500 py-6">
                  {scope === "day" ? (
                    <div className="space-y-2">
                      <div>За {date} нет активных чатов (оценок/задач).</div>
                      <div className="flex gap-2 justify-center">
                        {latestActivityDate && latestActivityDate !== date && (
                          <button
                            className="btn-secondary"
                            onClick={() => setDate(latestActivityDate)}
                          >
                            Последняя дата с активностью: {latestActivityDate}
                          </button>
                        )}
                        <button className="btn-secondary" onClick={() => setScope("all")}>
                          Показать все активные чаты
                        </button>
                      </div>
                    </div>
                  ) : (
                    "Нет чатов по текущим фильтрам."
                  )}
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
                prevStatuses={prevByChat.get(chat.agr_no) ?? {}}
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
  prevStatuses,
  onSaved,
}: {
  chat: Chat;
  accountants: Accountant[];
  date: string;
  existing: Evaluation | null;
  prevStatuses: Record<string, string>;
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

  // A row only shows a score once it's been scored (saved, a criterion entered,
  // a mailing status chosen, or an override typed). Otherwise it shows "—" so
  // an un-reviewed chat doesn't look like it already scored 100/Отлично.
  const touched =
    Boolean(savedId) ||
    DAILY_CRITERIA.some((c) => typeof criteria[c.id] === "number") ||
    MONTHLY_CATEGORIES.some((c) => Boolean(monthly[c.id]?.status)) ||
    override.trim() !== "";

  const setCrit = (id: CriterionId, v: string) =>
    setCriteria((c) => ({ ...c, [id]: v === "" ? undefined : Number(v) }));
  const setMon = (id: string, status: string) =>
    setMonthly((m) => ({ ...m, [id]: { ...m[id], status } }));

  async function save() {
    setSaving(true);
    setError(null);
    // Record the previous-check status for each mailing automatically.
    const monthlyWithPrev: Record<string, MonthlyStatus> = {};
    for (const cat of MONTHLY_CATEGORIES) {
      monthlyWithPrev[cat.id] = {
        status: monthly[cat.id]?.status ?? "",
        prev: prevStatuses[cat.id] ?? PREV_STATUS_DEFAULT,
      };
    }
    const payload = {
      chat_agr_no: chat.agr_no,
      checking_date: date,
      accountant: accountant || null,
      scores: { criteria, monthly: monthlyWithPrev },
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
      <td className="sticky left-0 z-10 bg-white space-y-1 align-top">
        <div className="flex items-center gap-2">
          <span className="font-medium">№ {chat.agr_no}</span>
          {chat.chat_link ? (
            <a
              href={chat.chat_link}
              target={TG_WINDOW}
              rel="noreferrer"
              className="text-blue-600 hover:underline text-xs whitespace-nowrap"
              title="Открыть чат в одной вкладке Telegram (быстро)"
            >
              Открыть ↗
            </a>
          ) : (
            <span className="text-gray-400 text-xs">нет ссылки</span>
          )}
          {chat.status !== "Active" && (
            <span className="text-xs text-gray-400">(неактивен)</span>
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
            className="input w-[116px] text-xs"
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
          {prevStatuses[c.id] && (
            <div className="text-[10px] text-gray-400 mt-0.5" title="Статус на прошлой проверке">
              пред: {prevStatuses[c.id]}
            </div>
          )}
        </td>
      ))}
      <td>
        <input
          className="input w-[60px] tabular-nums text-center"
          value={override !== "" ? override : touched ? total : ""}
          placeholder="—"
          onChange={(e) => setOverride(e.target.value)}
          title="Авто из критериев; можно переопределить"
        />
      </td>
      <td>
        {touched ? <BandChip total={total} /> : <span className="text-gray-300">—</span>}
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
