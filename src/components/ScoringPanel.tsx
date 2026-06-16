"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DAILY_CRITERIA,
  MONTHLY_CATEGORIES,
  PREV_STATUS_DEFAULT,
  GREETING_ACCURACY_CAP,
  REGISTRATION_PENALTIES,
  computeOverall,
  computeRegistrationScore,
  daysBetween,
  isStaleActivity,
  roleInfo,
  type CriteriaScores,
  type CriterionId,
  type EvalRole,
  type Greeting,
} from "@/lib/scoring";
import { predictEvaluation, toSnapshot, type AiModel } from "@/lib/ai";
import type { Accountant, Chat, Evaluation, MonthlyStatus } from "@/lib/types";
import BandChip from "./BandChip";

/** Everything carried forward from the most recent check before the chosen date. */
interface PrevCheck {
  date: string;
  monthly: Record<string, string>;
  criteria: CriteriaScores;
  greeting?: Greeting;
  comment: string;
}

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
  const [accFilters, setAccFilters] = useState<string[]>([]);
  const [onlyUnscored, setOnlyUnscored] = useState(false);
  const [activeOnly, setActiveOnly] = useState(true);
  const [hideStale, setHideStale] = useState(false);
  const [tgClient, setTgClient] = useState<TgClient>("a");
  // Render only a window of chats at a time so the page stays fast; "load more"
  // grows it. Reset whenever the filtered set changes (see effect below).
  const PAGE = 30;
  const [visibleCount, setVisibleCount] = useState(PAGE);

  // Restore a previously-chosen Telegram web client, if any.
  useEffect(() => {
    const saved = window.localStorage.getItem("qa_tg_client");
    if (saved === "a" || saved === "k") setTgClient(saved);
  }, []);

  // Refresh the chat/eval data every 40 minutes. With the bot feed wired in,
  // this is how the day view stays current through the day.
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 40 * 60 * 1000);
    return () => clearInterval(id);
  }, [router]);

  // The most recent check BEFORE the selected date — carried forward in full
  // (mailing statuses, criteria, greeting, comment) so Margarita only changes
  // what actually changed.
  const prevByChat = useMemo(() => {
    const latestBefore = new Map<string, Evaluation>();
    for (const e of evaluations) {
      if ((e.role ?? "accountant") !== "accountant") continue;
      if (e.checking_date.slice(0, 10) >= date) continue;
      const cur = latestBefore.get(e.chat_agr_no);
      if (!cur || e.checking_date > cur.checking_date) latestBefore.set(e.chat_agr_no, e);
    }
    const out = new Map<string, PrevCheck>();
    for (const [chatNo, e] of latestBefore) {
      const monthly: Record<string, string> = {};
      for (const cat of MONTHLY_CATEGORIES) {
        const s = e.scores.monthly?.[cat.id]?.status;
        if (s) monthly[cat.id] = s;
      }
      out.set(chatNo, {
        date: e.checking_date.slice(0, 10),
        monthly,
        criteria: e.scores.criteria ?? {},
        greeting: e.scores.greeting,
        comment: e.comment ?? "",
      });
    }
    return out;
  }, [evaluations, date]);

  // Last REAL chat activity per chat: the chat's own activity date (from the bot
  // feed / import) or, failing that, the latest task touch. Evaluations don't
  // count — checking a chat isn't the client/accountant being active in it.
  const lastTaskByChat = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of taskActivity) {
      if (!t.date) continue;
      const cur = m.get(t.chat_agr_no);
      if (!cur || t.date > cur) m.set(t.chat_agr_no, t.date);
    }
    return m;
  }, [taskActivity]);

  const lastActivityFor = useMemo(() => {
    return (c: Chat): string | null =>
      c.last_activity_date ?? lastTaskByChat.get(c.agr_no) ?? null;
  }, [lastTaskByChat]);

  // Liveness is a PRESENT-tense fact ("is this chat active right now?"), so it is
  // judged against TODAY — not the review date (which only says which day's QA we
  // are recording). A chat silent since Wednesday is stale today even if she is
  // back-filling an earlier date.
  const nowISO = useMemo(() => today(), []);

  // Accountant evaluations on the selected date, indexed by chat (drives the
  // unscored filter, day-activity set and worst-first sort).
  const evalForDate = useMemo(() => {
    const m = new Map<string, Evaluation>();
    for (const e of evaluations) {
      if ((e.role ?? "accountant") !== "accountant") continue;
      if (e.checking_date.slice(0, 10) === date) m.set(e.chat_agr_no, e);
    }
    return m;
  }, [evaluations, date]);

  // Every role's evaluation for the date, keyed `${chat}|${role}` — so each
  // chat group can show the accountant, manager and lawyer rows together.
  const evalByChatRole = useMemo(() => {
    const m = new Map<string, Evaluation>();
    for (const e of evaluations) {
      if (e.checking_date.slice(0, 10) !== date) continue;
      m.set(`${e.chat_agr_no}|${e.role ?? "accountant"}`, e);
    }
    return m;
  }, [evaluations, date]);

  // People suggestions for the manager / lawyer pickers. Managers come from the
  // chats' own manager field + non-accountant specialists; both grow from names
  // already used in saved role-evaluations.
  const managers = useMemo(() => {
    const s = new Set<string>();
    for (const c of chats) if (c.manager) s.add(c.manager);
    for (const a of accountants) if (a.role !== "accountant") s.add(a.name);
    for (const e of evaluations)
      if (e.role === "manager" && e.accountant) s.add(e.accountant);
    return [...s].sort();
  }, [chats, accountants, evaluations]);

  const lawyers = useMemo(() => {
    const s = new Set<string>();
    for (const e of evaluations)
      if (e.role === "lawyer" && e.accountant) s.add(e.accountant);
    return [...s].sort();
  }, [evaluations]);

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
      if (hideStale && isStaleActivity(lastActivityFor(c), nowISO)) return false;
      if (accFilters.length && !(c.accountant && accFilters.includes(c.accountant)))
        return false;
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
  }, [chats, search, accFilters, onlyUnscored, activeOnly, hideStale, lastActivityFor, nowISO, evalForDate, scope, activeTodaySet]);

  // Most problematic chats on top. Scored chats sort by Margarita's saved total;
  // un-scored ones are mixed in by the AI's predicted total.
  const sortedChats = useMemo(() => {
    const scoreFor = (c: Chat): number => {
      const ev = evalForDate.get(c.agr_no);
      if (ev) return ev.total_score;
      return predictEvaluation(c.accountant, prevByChat.get(c.agr_no)?.monthly ?? {}, aiModel)
        .total;
    };
    return [...visibleChats].sort(
      (a, b) => scoreFor(a) - scoreFor(b) || a.agr_no.localeCompare(b.agr_no)
    );
  }, [visibleChats, evalForDate, prevByChat, aiModel]);

  // Only render a window of the sorted list; "load more" grows it.
  const shownChats = sortedChats.slice(0, visibleCount);

  // When the filtered set changes, snap back to the first page.
  useEffect(() => {
    setVisibleCount(PAGE);
  }, [search, accFilters, onlyUnscored, activeOnly, hideStale, scope, date]);

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
          <label className="text-xs text-gray-500 block">Бухгалтеры</label>
          <AccountantMultiSelect
            accountants={accountants.map((a) => a.name)}
            selected={accFilters}
            onChange={setAccFilters}
          />
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
        <label
          className="flex items-center gap-1.5 text-sm text-gray-600 pb-1.5"
          title="Скрыть чаты без свежей активности — те, что давно «молчат», даже если статус ещё «Active»"
        >
          <input
            type="checkbox"
            checked={hideStale}
            onChange={(e) => setHideStale(e.target.checked)}
          />
          Скрыть без активности
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
          onClick={() => router.refresh()}
          title="Список обновляется автоматически каждые 40 минут"
        >
          Обновить ⟳
        </button>
      </div>

      {/* Compact legend. */}
      <p className="text-xs text-gray-500">
        Каждый чат: <span className="font-semibold text-indigo-700">🤖 AI</span> + ваша оценка
        бухгалтера. Внизу строки «+ добавить оценку» можно добавить{" "}
        <span className="font-semibold">👔 Менеджера</span> или{" "}
        <span className="font-semibold">⚖️ Юриста</span>. Значения перенесены из прошлой проверки —
        правьте изменившееся и жмите «Оценить». Проблемные чаты — сверху.
      </p>

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
              <th
                className="text-center"
                title="Приветствие: бухгалтер поздоровался / ответил на приветствие клиента. Если нет — «Точность и полнота» не выше 4 (не критично, но ошибка)."
              >
                Прив.
              </th>
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
                <td colSpan={13} className="text-center text-gray-500 py-6">
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
            {shownChats.map((chat) => (
              <ChatGroup
                key={`${chat.agr_no}|${date}`}
                chat={chat}
                accountants={accountants}
                date={date}
                managers={managers}
                lawyers={lawyers}
                accountantEval={evalByChatRole.get(`${chat.agr_no}|accountant`) ?? null}
                managerEval={evalByChatRole.get(`${chat.agr_no}|manager`) ?? null}
                lawyerEval={evalByChatRole.get(`${chat.agr_no}|lawyer`) ?? null}
                prev={prevByChat.get(chat.agr_no) ?? null}
                lastActivity={lastActivityFor(chat)}
                asOf={nowISO}
                aiModel={aiModel}
                tgClient={tgClient}
                onSaved={onSaved}
              />
            ))}
          </tbody>
        </table>
      </div>

      {sortedChats.length > visibleCount && (
        <div className="flex justify-center">
          <button
            className="btn-secondary"
            onClick={() => setVisibleCount((n) => n + PAGE)}
          >
            Показать ещё чаты ({sortedChats.length - visibleCount})
          </button>
        </div>
      )}
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
  prev,
  lastActivity,
  asOf,
  aiModel,
  tgClient,
  onSaved,
}: {
  chat: Chat;
  accountants: Accountant[];
  date: string;
  existing: Evaluation | null;
  prev: PrevCheck | null;
  lastActivity: string | null;
  asOf: string;
  aiModel: AiModel;
  tgClient: TgClient;
  onSaved: (e: Evaluation) => void;
}) {
  const prevStatuses = prev?.monthly ?? {};
  // No saved check for this date yet, but a previous one exists → pre-fill from
  // it so Margarita only edits what changed.
  const prefilledFromPrev = !existing && !!prev;

  const [accountant, setAccountant] = useState(
    existing?.accountant ?? chat.accountant ?? ""
  );
  const [criteria, setCriteria] = useState<CriteriaScores>(
    existing?.scores.criteria ?? prev?.criteria ?? {}
  );
  const [greeting, setGreeting] = useState<Greeting | "">(
    existing?.scores.greeting ?? prev?.greeting ?? ""
  );
  const [monthly, setMonthly] = useState<Record<string, MonthlyStatus>>(() => {
    const base = emptyMonthly();
    if (existing?.scores.monthly) return { ...base, ...existing.scores.monthly };
    for (const c of MONTHLY_CATEGORIES) {
      const p = prevStatuses[c.id];
      if (p) base[c.id] = { status: p, prev: p };
    }
    return base;
  });
  const [comment, setComment] = useState(existing?.comment ?? prev?.comment ?? "");
  const [override, setOverride] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(existing?.id ?? null);

  const greetingVal: Greeting | undefined = greeting === "" ? undefined : greeting;
  const staleDays = lastActivity ? daysBetween(lastActivity, asOf) : null;
  const isStale = isStaleActivity(lastActivity, asOf);

  // AI's row: same fields, predicted from the learned model. Re-predicts when
  // the accountant changes (the model is per-accountant).
  const ai = useMemo(
    () => predictEvaluation(accountant || null, prevStatuses, aiModel),
    [accountant, prevStatuses, aiModel]
  );

  const total =
    override.trim() !== "" && !Number.isNaN(Number(override))
      ? Number(override)
      : computeOverall(criteria, monthly, DAILY_CRITERIA, greetingVal);

  const touched =
    Boolean(savedId) ||
    prefilledFromPrev ||
    DAILY_CRITERIA.some((c) => typeof criteria[c.id] === "number") ||
    greeting !== "" ||
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
      scores: {
        criteria,
        greeting: greetingVal,
        monthly: monthlyWithPrev,
        ai: toSnapshot(ai),
      },
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
          className="chat-info sticky left-0 z-10 bg-white align-top min-w-[280px] max-w-[340px]"
        >
          {/* № + chat name + link, all on one line (name truncates). */}
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-gray-900 whitespace-nowrap">
              № {chat.agr_no}
            </span>
            <span
              className="text-gray-600 text-xs truncate min-w-0 flex-1"
              title={chat.chat_name}
            >
              {chat.chat_name}
            </span>
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
              <span className="text-gray-400 text-xs whitespace-nowrap">нет ссылки</span>
            )}
            {chat.status !== "Active" && (
              <span className="text-xs text-gray-400 whitespace-nowrap">(неактивен)</span>
            )}
          </div>
          {/* Last REAL activity — a chat can read "Active" yet have gone quiet
              days ago. Flag that so it isn't mistaken for a live chat. */}
          <div className="text-xs mt-1">
            {isStale ? (
              <span
                className="inline-block rounded bg-amber-100 text-amber-700 font-medium px-1.5 py-0.5"
                title="Чат давно без активности — не путать с живым «активным» чатом"
              >
                нет активности
                {lastActivity ? ` ${staleDays} дн. · с ${lastActivity}` : ""}
              </span>
            ) : (
              <span className="text-gray-400">активность: {lastActivity}</span>
            )}
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
          {prefilledFromPrev && !savedId && (
            <div
              className="text-[10px] text-gray-400 mt-1"
              title="Значения перенесены из прошлой проверки — измените только то, что изменилось"
            >
              ← перенесено с {prev?.date}
            </div>
          )}
        </td>
        <td className={`${aiCell} text-center`}>
          <span
            className="inline-block rounded bg-indigo-100 text-indigo-700 font-semibold text-[11px] px-1.5 py-0.5 whitespace-nowrap"
            title={ai.note}
          >
            🤖 AI
          </span>
        </td>
        {DAILY_CRITERIA.map((c) => (
          <td key={c.id} className={`${aiCell} text-center tabular-nums`} title={c.name}>
            {ai.criteria[c.id]}
          </td>
        ))}
        {/* Greeting is read from the chat text by Margarita — AI doesn't judge it. */}
        <td className={`${aiCell} text-center text-gray-400`}>—</td>
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
          <span className="inline-block rounded bg-blue-600 text-white font-semibold text-[11px] px-1.5 py-0.5 whitespace-nowrap">
            ✍️ Вы
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
        {/* Greeting toggle — no greeting caps Точность at 4 (small, non-critical). */}
        <td className={`${youCell} text-center`}>
          <select
            className="input w-[52px]"
            value={greeting}
            onChange={(e) => setGreeting(e.target.value as Greeting | "")}
            title="Поздоровался / ответил на приветствие? Если «нет» — Точность не выше 4."
          >
            <option value="">—</option>
            <option value="yes">✓</option>
            <option value="no">✗</option>
          </select>
          {greeting === "no" && (
            <div className="text-[10px] text-amber-600 leading-tight mt-0.5">
              Точн. ≤ {GREETING_ACCURACY_CAP}
            </div>
          )}
        </td>
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

/**
 * One editable row for the менеджер / юрист roles. Both grade a chat on the
 * registration penalty model (start 100, minus penalties) — a single row, no AI
 * suggestion. The graded person is stored in the evaluation's `accountant` field.
 */
function RegRoleRow({
  chat,
  role,
  date,
  people,
  existing,
  onSaved,
}: {
  chat: Chat;
  role: EvalRole;
  date: string;
  people: string[];
  existing: Evaluation | null;
  onSaved: (e: Evaluation) => void;
}) {
  const [person, setPerson] = useState(
    existing?.accountant ?? (role === "manager" ? chat.manager ?? "" : "")
  );
  const [counts, setCounts] = useState<Record<string, number>>(
    existing?.scores.registration ?? {}
  );
  const [comment, setComment] = useState(existing?.comment ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(existing?.id ?? null);

  const total = computeRegistrationScore(counts);
  const touched =
    Boolean(savedId) || REGISTRATION_PENALTIES.some((p) => (counts[p.id] ?? 0) > 0);
  const info = roleInfo(role);
  // Span the accountant criteria columns (Точн/СЛА/Прив + 4 monthly) with the
  // three penalty inputs, so this role's row stays aligned with the grid.
  const critColSpan = DAILY_CRITERIA.length + 1 + MONTHLY_CATEGORIES.length;
  const listId = `reg-people-${role}`;

  const setCount = (id: string, v: string) =>
    setCounts((c) => ({ ...c, [id]: v === "" ? 0 : Math.max(0, Number(v)) }));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        savedId ? `/api/evaluations/${savedId}` : "/api/evaluations",
        {
          method: savedId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_agr_no: chat.agr_no,
            checking_date: date,
            role,
            accountant: person || null,
            scores: { scheme: "registration", registration: counts },
            comment: comment || null,
          }),
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

  return (
    <tr className={savedId ? "" : "bg-violet-50/30"}>
      {/* Role + person — sits in the same sticky first column as the chat info. */}
      <td className="sticky left-0 z-10 bg-white align-middle min-w-[210px]">
        <div className="flex items-center gap-1.5">
          <span title={info.label}>{info.icon}</span>
          <input
            list={listId}
            className="input w-full text-xs"
            placeholder={info.label.toLowerCase()}
            value={person}
            onChange={(e) => setPerson(e.target.value)}
          />
          <datalist id={listId}>
            {people.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>
      </td>
      <td className="text-center align-middle">
        <span className="inline-block rounded bg-gray-200 text-gray-700 font-semibold text-[11px] px-1.5 py-0.5">
          {role === "manager" ? "Мен" : "Юр"}
        </span>
      </td>
      <td colSpan={critColSpan} className="align-middle">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {REGISTRATION_PENALTIES.map((p) => (
            <label
              key={p.id}
              className="inline-flex items-center gap-1 text-xs text-gray-600"
              title={`${p.name} — ${p.goal} (${p.points})`}
            >
              {p.id === "critical" ? "Крит." : p.id === "speed" ? "Скор." : "ОС"}
              <input
                type="number"
                min={0}
                className="input w-[48px] text-center"
                placeholder="0"
                value={counts[p.id] ?? ""}
                onChange={(e) => setCount(p.id, e.target.value)}
              />
            </label>
          ))}
        </div>
      </td>
      <td className="text-center align-middle tabular-nums font-semibold">
        {touched ? total : <span className="text-gray-300">—</span>}
      </td>
      <td className="align-middle">
        {touched ? <BandChip total={total} /> : <span className="text-gray-300">—</span>}
      </td>
      <td className="align-middle">
        <input
          className="input w-full"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="комментарий…"
        />
      </td>
      <td className="whitespace-nowrap text-right align-middle">
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
  );
}

/**
 * One chat's row group: the accountant rows always show; the manager and lawyer
 * rows appear only once added (or when they already have a saved score). A thin
 * "add person" row at the bottom lets Margarita pull in a manager or lawyer.
 */
function ChatGroup({
  chat,
  accountants,
  date,
  managers,
  lawyers,
  accountantEval,
  managerEval,
  lawyerEval,
  prev,
  lastActivity,
  asOf,
  aiModel,
  tgClient,
  onSaved,
}: {
  chat: Chat;
  accountants: Accountant[];
  date: string;
  managers: string[];
  lawyers: string[];
  accountantEval: Evaluation | null;
  managerEval: Evaluation | null;
  lawyerEval: Evaluation | null;
  prev: PrevCheck | null;
  lastActivity: string | null;
  asOf: string;
  aiModel: AiModel;
  tgClient: TgClient;
  onSaved: (e: Evaluation) => void;
}) {
  const [showManager, setShowManager] = useState(Boolean(managerEval));
  const [showLawyer, setShowLawyer] = useState(Boolean(lawyerEval));
  const totalCols = DAILY_CRITERIA.length + MONTHLY_CATEGORIES.length + 7;

  return (
    <>
      <ChatScoreRow
        chat={chat}
        accountants={accountants}
        date={date}
        existing={accountantEval}
        prev={prev}
        lastActivity={lastActivity}
        asOf={asOf}
        aiModel={aiModel}
        tgClient={tgClient}
        onSaved={onSaved}
      />
      {showManager && (
        <RegRoleRow
          chat={chat}
          role="manager"
          date={date}
          people={managers}
          existing={managerEval}
          onSaved={onSaved}
        />
      )}
      {showLawyer && (
        <RegRoleRow
          chat={chat}
          role="lawyer"
          date={date}
          people={lawyers}
          existing={lawyerEval}
          onSaved={onSaved}
        />
      )}
      {(!showManager || !showLawyer) && (
        <tr>
          <td colSpan={totalCols} className="py-1.5 pl-2 bg-gray-50/40">
            <span className="text-xs text-gray-400 mr-2">+ добавить оценку:</span>
            {!showManager && (
              <button
                className="btn-secondary !px-2 !py-0.5 text-xs mr-2"
                onClick={() => setShowManager(true)}
              >
                👔 Менеджер
              </button>
            )}
            {!showLawyer && (
              <button
                className="btn-secondary !px-2 !py-0.5 text-xs"
                onClick={() => setShowLawyer(true)}
              >
                ⚖️ Юрист
              </button>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/** Filter control: pick any number of accountants via a checkbox dropdown. */
function AccountantMultiSelect({
  accountants,
  selected,
  onChange,
}: {
  accountants: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const toggle = (name: string) =>
    onChange(
      selected.includes(name)
        ? selected.filter((x) => x !== name)
        : [...selected, name]
    );

  const label =
    selected.length === 0
      ? "Все"
      : selected.length === 1
      ? selected[0]
      : `${selected.length} выбрано`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="input flex items-center justify-between gap-2 min-w-[160px]"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="truncate">{label}</span>
        <span className="text-gray-400">▾</span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-64 max-h-72 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg p-2">
          {selected.length > 0 && (
            <button
              className="text-xs text-blue-600 mb-1 px-1"
              onClick={() => onChange([])}
            >
              Сбросить (все)
            </button>
          )}
          {accountants.map((name) => (
            <label
              key={name}
              className="flex items-center gap-2 text-sm py-0.5 px-1 rounded hover:bg-gray-50 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.includes(name)}
                onChange={() => toggle(name)}
              />
              <span className="truncate">{name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
