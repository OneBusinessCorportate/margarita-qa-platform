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
import { predictEvaluation, toSnapshot, type AiModel } from "@/lib/ai";
import type { Accountant, Chat, Evaluation, MonthlyStatus } from "@/lib/types";
import BandChip from "./BandChip";

const today = () => new Date().toISOString().slice(0, 10);

// Open all chat links in ONE reused Telegram tab per account — switching chats
// just changes the hash, so Telegram Web stays loaded (no 7s reload each time).
// The "K" web client (web.telegram.org/k/) loads much faster than "A".
type TgClient = "a" | "k";

function tgWindowFor(link: string): string {
  return link.includes("account=2") ? "telegram_chat_2" : "telegram_chat";
}

/** Rewrite a web.telegram.org/a/ link to the chosen (faster) client. */
function tgHref(link: string, client: TgClient): string {
  if (client === "k" && link.includes("web.telegram.org/a/")) {
    return link.replace("web.telegram.org/a/", "web.telegram.org/k/");
  }
  return link;
}

type Scope = "day" | "all";

export default function ScoringPanel({
  chats,
  accountants,
  initialEvaluations,
  aiModel,
  taskActivity = [],
  latestActivityDate = null,
}: {
  chats: Chat[];
  accountants: Accountant[];
  initialEvaluations: Evaluation[];
  aiModel: AiModel;
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
  const [tgClient, setTgClient] = useState<TgClient>("a");

  // Persist the chosen Telegram web client.
  useEffect(() => {
    const saved = window.localStorage.getItem("qa_tg_client");
    if (saved === "a" || saved === "k") setTgClient(saved);
  }, []);
  function chooseTg(c: TgClient) {
    setTgClient(c);
    window.localStorage.setItem("qa_tg_client", c);
  }

  // Refresh the chat/eval data every 40 minutes. With the bot feed wired in,
  // this is how the day view stays current through the day.
  useEffect(() => {
    const id = setInterval(() => {
      router.refresh();
      setRefreshedAt(new Date().toLocaleTimeString("ru-RU"));
    }, 40 * 60 * 1000);
    return () => clearInterval(id);
  }, [router]);

  // Previous status per chat per mailing = the status at the most recent
  // evaluation BEFORE the selected date.
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

  // Most problematic chats on top. Scored chats sort by Margarita's saved total;
  // un-scored ones are mixed in by the AI's predicted total.
  const sortedChats = useMemo(() => {
    const scoreFor = (c: Chat): number => {
      const ev = evalForDate.get(c.agr_no);
      if (ev) return ev.total_score;
      return predictEvaluation(c.accountant, prevByChat.get(c.agr_no) ?? {}, aiModel)
        .total;
    };
    return [...visibleChats].sort(
      (a, b) => scoreFor(a) - scoreFor(b) || a.agr_no.localeCompare(b.agr_no)
    );
  }, [visibleChats, evalForDate, prevByChat, aiModel]);

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

      {/* Compact action bar — Telegram + refresh only. */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <a
          href={`https://web.telegram.org/${tgClient}/`}
          target="telegram_chat"
          rel="noreferrer"
          className="btn-secondary"
          title="Откройте Telegram один раз — дальше каждый чат по ссылке открывается мгновенно в этой же вкладке"
        >
          Открыть Telegram ⚡
        </a>
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
        <span className="inline-flex items-center gap-1 text-xs text-gray-400">
          клиент:
          <button
            className={`px-2 py-0.5 rounded ${tgClient === "a" ? "bg-blue-600 text-white" : "border border-gray-300"}`}
            onClick={() => chooseTg("a")}
            title="Telegram Web A (привычный)"
          >
            A
          </button>
          <button
            className={`px-2 py-0.5 rounded ${tgClient === "k" ? "bg-blue-600 text-white" : "border border-gray-300"}`}
            onClick={() => chooseTg("k")}
            title="Telegram Web K — загружается заметно быстрее"
          >
            K
          </button>
        </span>
        {refreshedAt && (
          <span className="text-xs text-gray-400">обновлено в {refreshedAt}</span>
        )}
      </div>

      {/* Legend — explains the two lines per chat in plain words. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block rounded bg-indigo-100 text-indigo-700 font-medium px-1.5 py-0.5">
            AI
          </span>
          подсказка — что предлагает система
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block rounded bg-blue-600 text-white font-medium px-1.5 py-0.5">
            Вы
          </span>
          ваша оценка — её и сохраняем
        </span>
        <span>Самые проблемные чаты — сверху.</span>
      </div>

      <div className="card">
        <table className="qa pairs sticky-head">
          <thead>
            <tr>
              <th className="corner sticky left-0 bg-gray-100 min-w-[210px]">
                № / Чат / Бухгалтер
              </th>
              <th className="text-center">Кто</th>
              {DAILY_CRITERIA.map((c) => (
                <th key={c.id} className="text-center" title={c.name}>
                  {c.id === "accuracy" ? "Точн." : "СЛА"}
                </th>
              ))}
              {MONTHLY_CATEGORIES.map((c) => (
                <th key={c.id} title={c.name}>
                  {c.shortName}
                </th>
              ))}
              <th className="text-center">Общая</th>
              <th>Кач-во</th>
              <th className="w-full">Коммент.</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sortedChats.length === 0 && (
              <tr>
                <td colSpan={12} className="text-center text-gray-500 py-6">
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
            {sortedChats.map((chat) => (
              <ChatScoreRow
                key={`${chat.agr_no}|${date}`}
                chat={chat}
                accountants={accountants}
                date={date}
                existing={evalForDate.get(chat.agr_no) ?? null}
                prevStatuses={prevByChat.get(chat.agr_no) ?? {}}
                aiModel={aiModel}
                tgClient={tgClient}
                onSaved={onSaved}
              />
            ))}
          </tbody>
        </table>
      </div>
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
  aiModel,
  tgClient,
  onSaved,
}: {
  chat: Chat;
  accountants: Accountant[];
  date: string;
  existing: Evaluation | null;
  prevStatuses: Record<string, string>;
  aiModel: AiModel;
  tgClient: TgClient;
  onSaved: (e: Evaluation) => void;
}) {
  const [accountant, setAccountant] = useState(
    existing?.accountant ?? chat.accountant ?? ""
  );
  const [criteria, setCriteria] = useState<CriteriaScores>(
    existing?.scores.criteria ?? {}
  );
  const [monthly, setMonthly] = useState<Record<string, MonthlyStatus>>(() => {
    const base = emptyMonthly();
    if (existing?.scores.monthly) return { ...base, ...existing.scores.monthly };
    for (const c of MONTHLY_CATEGORIES) {
      const prev = prevStatuses[c.id];
      if (prev) base[c.id] = { status: prev, prev };
    }
    return base;
  });
  const [comment, setComment] = useState(existing?.comment ?? "");
  const [override, setOverride] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(existing?.id ?? null);

  // AI's row: same fields, predicted from the learned model. Re-predicts when
  // the accountant changes (the model is per-accountant).
  const ai = useMemo(
    () => predictEvaluation(accountant || null, prevStatuses, aiModel),
    [accountant, prevStatuses, aiModel]
  );

  const total =
    override.trim() !== "" && !Number.isNaN(Number(override))
      ? Number(override)
      : computeOverall(criteria, monthly);

  const touched =
    Boolean(savedId) ||
    DAILY_CRITERIA.some((c) => typeof criteria[c.id] === "number") ||
    override.trim() !== "";

  const setCrit = (id: CriterionId, v: string) =>
    setCriteria((c) => ({ ...c, [id]: v === "" ? undefined : Number(v) }));
  const setMon = (id: string, status: string) =>
    setMonthly((m) => ({ ...m, [id]: { ...m[id], status } }));

  /** One click: agree with the AI — its row becomes Margarita's answer. */
  function acceptAi() {
    setCriteria({ ...ai.criteria });
    setMonthly((m) => {
      const next = { ...m };
      for (const c of MONTHLY_CATEGORIES) {
        next[c.id] = { ...next[c.id], status: ai.monthly[c.id]?.status ?? "" };
      }
      return next;
    });
    setOverride(String(ai.total));
  }

  async function save() {
    setSaving(true);
    setError(null);
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
      // The AI snapshot is stored with her answer — the training pair.
      scores: { criteria, monthly: monthlyWithPrev, ai: toSnapshot(ai) },
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

  // Shared cell classes: a thick top border opens each chat group; the AI row
  // has no bottom border so the two lines read as one chat.
  const aiCell = "ai-cell bg-indigo-50/60 text-gray-600 align-middle";
  const youCell = "align-middle";

  return (
    <>
      {/* ---- AI suggestion line ---- */}
      <tr className="chat-start">
        <td
          rowSpan={2}
          className="chat-info sticky left-0 z-10 bg-white align-top min-w-[210px]"
        >
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900">№ {chat.agr_no}</span>
            {chat.chat_link ? (
              <a
                href={tgHref(chat.chat_link, tgClient)}
                target={tgWindowFor(chat.chat_link)}
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
          <div className="text-gray-600 text-xs mt-0.5 truncate max-w-[210px]" title={chat.chat_name}>
            {chat.chat_name}
          </div>
          <select
            className="input w-full text-xs mt-1"
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
        </td>
        <td className={`${aiCell} text-center`}>
          <span
            className="inline-block rounded bg-indigo-100 text-indigo-700 font-semibold text-[11px] px-1.5 py-0.5"
            title={ai.note}
          >
            AI
          </span>
        </td>
        {DAILY_CRITERIA.map((c) => (
          <td key={c.id} className={`${aiCell} text-center tabular-nums`} title={c.name}>
            {ai.criteria[c.id]}
          </td>
        ))}
        {MONTHLY_CATEGORIES.map((c) => (
          <td key={c.id} className={`${aiCell} text-xs`}>
            <span className="block truncate max-w-[120px]" title={ai.monthly[c.id]?.status}>
              {ai.monthly[c.id]?.status || "—"}
            </span>
          </td>
        ))}
        <td className={`${aiCell} text-center tabular-nums font-semibold`}>{ai.total}</td>
        <td className={aiCell}>
          <BandChip band={ai.band} />
        </td>
        <td className={`${aiCell} text-xs italic text-gray-500`}>
          <span className="block truncate max-w-[260px]" title={ai.note}>
            {ai.note}
          </span>
        </td>
        <td className={`${aiCell} whitespace-nowrap text-right`}>
          <button
            className="btn-secondary !px-2 !py-0.5 text-xs"
            onClick={acceptAi}
            title="Согласиться с AI — перенести его оценку в вашу строку"
          >
            Принять
          </button>
        </td>
      </tr>

      {/* ---- Your editable line ---- */}
      <tr className={savedId ? "" : "bg-blue-50/40"}>
        <td className={`${youCell} text-center`}>
          <span className="inline-block rounded bg-blue-600 text-white font-semibold text-[11px] px-1.5 py-0.5">
            Вы
          </span>
        </td>
        {DAILY_CRITERIA.map((c) => (
          <td key={c.id} className={`${youCell} text-center`}>
            <select
              className="input w-[46px]"
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
          <td key={c.id} className={youCell}>
            <select
              className="input w-full min-w-[112px] text-xs"
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
        <td className={`${youCell} text-center`}>
          <input
            className="input w-[50px] tabular-nums text-center"
            value={override !== "" ? override : touched ? total : ""}
            placeholder="—"
            onChange={(e) => setOverride(e.target.value)}
            title="Авто из критериев; можно переопределить"
          />
        </td>
        <td className={youCell}>
          {touched ? <BandChip total={total} /> : <span className="text-gray-300">—</span>}
        </td>
        <td className={youCell}>
          <input
            className="input w-full"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="комментарий…"
          />
        </td>
        <td className={`${youCell} whitespace-nowrap text-right`}>
          <button
            className="btn-primary !px-3 !py-1 text-xs"
            onClick={save}
            disabled={saving}
          >
            {saving ? "…" : savedId ? "Сохр." : "Оценить"}
          </button>
          {savedId && <span className="ml-1 text-[10px] text-green-600">✓</span>}
          {error && <span className="ml-1 text-[10px] text-red-600">{error}</span>}
        </td>
      </tr>
    </>
  );
}
