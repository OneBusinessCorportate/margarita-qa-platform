"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DAILY_CRITERIA,
  MONTHLY_CATEGORIES,
  PREV_STATUS_DEFAULT,
  REGISTRATION_PENALTIES,
  computeOverall,
  computeRegistrationScore,
  daysBetween,
  isStaleActivity,
  roleInfo,
  type CriteriaScores,
  type CriterionId,
  type EvalRole,
} from "@/lib/scoring";
import { predictEvaluation, toSnapshot, type AiModel } from "@/lib/ai";
import {
  SORT_OPTIONS,
  autoDebtStatus,
  autoMonthlyStatus,
  cmpAgrNo,
  compareByActivity,
  debtAmountLabel,
  debtTone,
  isTelegramLink,
  waitingLabel,
  type SortBy,
} from "@/lib/chat-list";
import type {
  Accountant,
  ActiveExclusion,
  Chat,
  Evaluation,
  MonthlyStatus,
} from "@/lib/types";
import BandChip from "./BandChip";

/** Everything carried forward from the most recent check before the chosen date. */
interface PrevCheck {
  date: string;
  monthly: Record<string, string>;
  criteria: CriteriaScores;
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

/** Per-chat hide/restore control for the "Активные за день" view (day scope). */
type HideControl = { hidden: boolean; onToggle: () => void } | null;

export default function ScoringPanel({
  chats,
  accountants,
  initialEvaluations,
  aiModel,
  taskActivity = [],
  chatActivity = [],
  latestActivityDate = null,
  initialExclusions = [],
}: {
  chats: Chat[];
  accountants: Accountant[];
  initialEvaluations: Evaluation[];
  aiModel: AiModel;
  taskActivity?: { chat_agr_no: string; date: string }[];
  chatActivity?: { chat_agr_no: string; date: string; at?: string | null }[];
  latestActivityDate?: string | null;
  initialExclusions?: ActiveExclusion[];
}) {
  const router = useRouter();
  const [evaluations, setEvaluations] = useState<Evaluation[]>(initialEvaluations);
  const [date, setDate] = useState(latestActivityDate ?? today());
  // Default to the day view: Margarita works through one day's chats in time
  // order, bottom-to-top. "All active chats" stays a click away.
  const [scope, setScope] = useState<Scope>("day");
  const [sortBy, setSortBy] = useState<SortBy>("activity");
  const [search, setSearch] = useState("");
  const [accFilters, setAccFilters] = useState<string[]>([]);
  const [onlyUnscored, setOnlyUnscored] = useState(false);
  const [activeOnly, setActiveOnly] = useState(true);
  const [hideStale, setHideStale] = useState(false);
  // Default to the "K" web client — it loads much faster than "A" (helps the
  // "chats open slowly / sometimes don't open" complaint). A saved choice wins.
  const [tgClient, setTgClient] = useState<TgClient>("k");
  // Chats QA manually hid from "Активные за день", keyed `${agr_no}|${date}`.
  const [excluded, setExcluded] = useState<Set<string>>(
    () => new Set(initialExclusions.map((e) => `${e.chat_agr_no}|${e.exclude_date}`))
  );
  // When on, hidden chats are shown again (with a "Вернуть" button) so QA can
  // review/undo what was hidden for the day.
  const [showHidden, setShowHidden] = useState(false);
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
  // (mailing statuses, criteria, comment) so Margarita only changes what
  // actually changed.
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
  // Precise current time, for "how long has this chat been waiting" labels.
  const nowTs = useMemo(() => new Date().toISOString(), []);

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

  // Chats genuinely active on the selected date. Primary source is the per-day
  // activity feed (mqa_chat_activity): EVERY chat that had a message that day,
  // so a chat active on several days shows on each of them — not only its most
  // recent day (the old single-last_activity_date behaviour hid 30–60% of a
  // day's active chats). The chat's own last_activity_date and a same-day task
  // are kept as fallbacks. An evaluation does NOT count — scoring a chat isn't
  // the client/accountant being active in it.
  const activeTodaySet = useMemo(() => {
    const s = new Set<string>();
    for (const a of chatActivity) if (a.date === date) s.add(a.chat_agr_no);
    for (const c of chats) if (lastActivityFor(c) === date) s.add(c.agr_no);
    for (const t of taskActivity) if (t.date === date) s.add(t.chat_agr_no);
    // Backlog: chats where the CLIENT had the last word (still unanswered) stay
    // in the day view even if their last message was on an earlier day, so the
    // "start from the bottom unanswered chat" workflow can reach yesterday's.
    for (const c of chats) if (c.unanswered === true) s.add(c.agr_no);
    return s;
  }, [chatActivity, chats, lastActivityFor, taskActivity, date]);

  // Precise activity time for a chat ON the selected day (from the per-day feed),
  // so the day view sorts by when the chat was actually active that day — not by
  // the chat's most-recent activity across all days (which looked random).
  const activityAtForDay = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of chatActivity) {
      if (a.date !== date || !a.at) continue;
      const cur = m.get(a.chat_agr_no);
      if (!cur || a.at > cur) m.set(a.chat_agr_no, a.at);
    }
    return m;
  }, [chatActivity, date]);

  const isHidden = (agrNo: string) => excluded.has(`${agrNo}|${date}`);

  // How many of the day's active chats QA has hidden (drives the "Скрытые (N)"
  // toggle). Only meaningful in the day view.
  const hiddenCount = useMemo(() => {
    let n = 0;
    for (const agr of activeTodaySet) if (excluded.has(`${agr}|${date}`)) n += 1;
    return n;
  }, [activeTodaySet, excluded, date]);

  const visibleChats = useMemo(() => {
    const n = search.trim().toLowerCase();
    return chats.filter((c) => {
      // Day view = chats active that day.
      if (scope === "day" && !activeTodaySet.has(c.agr_no))
        return false;
      // Hidden-for-this-day chats drop out of the day view unless QA chose to
      // show them (to undo). They never affect the "all active chats" view.
      if (scope === "day" && excluded.has(`${c.agr_no}|${date}`) && !showHidden)
        return false;
      // The imported `status` flag goes stale, which hid genuinely active chats.
      // In the day view a chat IS in the list because it was really active that
      // day, so the status flag must not filter it out there. Only the "all"
      // scope honours the status flag.
      if (activeOnly && scope === "all" && c.status !== "Active") return false;
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
  }, [chats, search, accFilters, onlyUnscored, activeOnly, hideStale, lastActivityFor, nowISO, evalForDate, scope, activeTodaySet, excluded, date, showHidden]);

  // The list order. By default chats are ordered by most recent real activity
  // (the order Margarita expects); she can switch to "problem chats on top" or
  // contract-№ order. Uses the precise last_activity_at timestamp from the sync,
  // so chats active the same day order by real message time (11:00 above 10:30);
  // chats with only a date (or none) are tie-broken by contract №.
  //
  // Order is FROZEN against saving: once the list is laid out for a given set of
  // filters/date/sort, saving a chat must not make it jump. The activity and №
  // orders don't depend on scores at all, so they're stable for free. The
  // "worst" order does depend on scores, so we snapshot it (orderRef) and reuse
  // that snapshot until the filters/date/sort actually change.
  const orderSig = useMemo(
    () =>
      JSON.stringify([
        scope,
        date,
        sortBy,
        activeOnly,
        hideStale,
        onlyUnscored,
        showHidden,
        accFilters,
        search,
      ]),
    [scope, date, sortBy, activeOnly, hideStale, onlyUnscored, showHidden, accFilters, search]
  );
  const orderRef = useRef<{ sig: string; ids: string[] }>({ sig: "", ids: [] });

  const sortedChats = useMemo(() => {
    const arr = [...visibleChats];
    if (sortBy === "number") {
      arr.sort((a, b) => cmpAgrNo(a.agr_no, b.agr_no));
      return arr;
    }
    if (sortBy === "activity") {
      // Most recent first by precise message time. In the day view, use the
      // chat's activity time ON that day (so 11:00 sorts above 10:30 for the day
      // being reviewed, not by the chat's latest activity on some other day).
      // Falls back to the global timestamp, the date, then a task touch.
      const key = (c: Chat) =>
        (scope === "day" ? activityAtForDay.get(c.agr_no) : undefined) ??
        c.last_activity_at ??
        lastActivityFor(c) ??
        "";
      arr.sort((a, b) => compareByActivity(a, b, key));
      return arr;
    }
    // "worst": problem chats on top, by saved total or the AI's predicted total.
    const scoreFor = (c: Chat): number => {
      const ev = evalForDate.get(c.agr_no);
      if (ev) return ev.total_score;
      return predictEvaluation(c.accountant, prevByChat.get(c.agr_no)?.monthly ?? {}, aiModel)
        .total;
    };
    if (orderRef.current.sig === orderSig && orderRef.current.ids.length) {
      // Reuse the frozen order so a just-saved chat keeps its place.
      const pos = new Map(orderRef.current.ids.map((id, i) => [id, i]));
      arr.sort(
        (a, b) =>
          (pos.get(a.agr_no) ?? Number.MAX_SAFE_INTEGER) -
            (pos.get(b.agr_no) ?? Number.MAX_SAFE_INTEGER) ||
          cmpAgrNo(a.agr_no, b.agr_no)
      );
    } else {
      arr.sort((a, b) => scoreFor(a) - scoreFor(b) || cmpAgrNo(a.agr_no, b.agr_no));
      orderRef.current = { sig: orderSig, ids: arr.map((c) => c.agr_no) };
    }
    return arr;
  }, [visibleChats, sortBy, lastActivityFor, evalForDate, prevByChat, aiModel, orderSig, scope, activityAtForDay]);

  // Only render a window of the sorted list; "load more" grows it.
  const shownChats = sortedChats.slice(0, visibleCount);

  // When the filtered set changes, snap back to the first page.
  useEffect(() => {
    setVisibleCount(PAGE);
  }, [search, accFilters, onlyUnscored, activeOnly, hideStale, scope, date, sortBy]);

  // Changing the day (or leaving the day view) re-hides hidden chats.
  useEffect(() => {
    setShowHidden(false);
  }, [date, scope]);

  function onSaved(saved: Evaluation) {
    setEvaluations((prev) => [saved, ...prev.filter((e) => e.id !== saved.id)]);
  }

  // Hide / restore a chat for the selected day. Optimistic: update the set
  // immediately, persist in the background, and revert if the request fails.
  async function setChatHidden(agrNo: string, hidden: boolean) {
    const key = `${agrNo}|${date}`;
    setExcluded((s) => {
      const next = new Set(s);
      if (hidden) next.add(key);
      else next.delete(key);
      return next;
    });
    try {
      const res = await fetch("/api/active-exclusions", {
        method: hidden ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agr_no: agrNo, date }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setExcluded((s) => {
        const next = new Set(s);
        if (hidden) next.delete(key);
        else next.add(key);
        return next;
      });
    }
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
        <div className="space-y-1">
          <label className="text-xs text-gray-500 block">Сортировка</label>
          <select
            className="input"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            title="Порядок чатов в списке. Порядок не меняется, когда вы оцениваете чат."
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
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
        {scope === "day" && (hiddenCount > 0 || showHidden) && (
          <button
            className="btn-secondary"
            onClick={() => setShowHidden((v) => !v)}
            title="Чаты, вручную скрытые из списка «Активные за день». Нажмите, чтобы показать и при необходимости вернуть."
          >
            {showHidden ? "Скрыть скрытые" : `Скрытые за день (${hiddenCount})`}
          </button>
        )}
      </div>

      {/* At-a-glance counts. */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-block rounded bg-blue-50 text-blue-700 font-medium px-2 py-1">
          Активных за {date}: {Math.max(0, activeTodaySet.size - hiddenCount)}
        </span>
        <span className="inline-block rounded bg-green-50 text-green-700 font-medium px-2 py-1">
          ✓ Оценено за {date}: {evalForDate.size}
        </span>
      </div>

      {/* Scroll the wide grid inside its own box so the sticky HEADER ROW pins
          relative to THIS container. The first column is intentionally NOT
          horizontally pinned — it scrolls with the grid. */}
      <div className="card overflow-auto max-h-[78vh]">
        <table className="qa pairs sticky-head">
          <thead>
            <tr>
              <th className="corner bg-gray-100 min-w-[210px]">
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
                asOf={nowTs}
                aiModel={aiModel}
                tgClient={tgClient}
                onSaved={onSaved}
                hideControl={
                  scope === "day"
                    ? {
                        hidden: isHidden(chat.agr_no),
                        onToggle: () =>
                          setChatHidden(chat.agr_no, !isHidden(chat.agr_no)),
                      }
                    : null
                }
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
  hideControl = null,
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
  hideControl?: HideControl;
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
  const [monthly, setMonthly] = useState<Record<string, MonthlyStatus>>(() => {
    const base = emptyMonthly();
    if (existing?.scores.monthly) return { ...base, ...existing.scores.monthly };
    for (const c of MONTHLY_CATEGORIES) {
      const p = prevStatuses[c.id];
      if (p) base[c.id] = { status: p, prev: p };
    }
    // Auto-fill every status we can determine from facts (debt feed, client
    // status, the deadline date) so Margarita only edits the exceptions instead
    // of picking "Нет долга" / "Предстоящая" by hand on every row. Editable.
    for (const c of MONTHLY_CATEGORIES) {
      if (base[c.id].status) continue; // a carried-over value wins
      const auto = autoMonthlyStatus(c, chat.status, chat.debts, date);
      if (auto)
        base[c.id] = { status: auto, prev: prevStatuses[c.id] ?? PREV_STATUS_DEFAULT };
    }
    return base;
  });
  const [comment, setComment] = useState(existing?.comment ?? prev?.comment ?? "");
  const [override, setOverride] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(existing?.id ?? null);

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
      : computeOverall(criteria, monthly, DAILY_CRITERIA);

  const touched =
    Boolean(savedId) ||
    prefilledFromPrev ||
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
      // Real debt data wins over the AI's guess for the "Долги" status.
      const autoDebt = autoDebtStatus(chat.debts);
      if (autoDebt) next["debts"] = { ...next["debts"], status: autoDebt };
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
      <tr className={`chat-start ${savedId ? "bg-green-100" : ""}`}>
        <td
          rowSpan={2}
          className={`chat-info align-top min-w-[280px] max-w-[340px] ${
            savedId ? "bg-green-100 border-l-8 border-green-600" : "bg-white"
          }`}
        >
          {/* № + chat name + link, all on one line (name truncates). */}
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-gray-900 whitespace-nowrap">
              № {chat.agr_no}
            </span>
            {savedId && (
              <span
                className="inline-flex items-center gap-1 rounded bg-green-600 text-white font-bold text-xs px-2 py-1 whitespace-nowrap shadow-sm"
                title="Этот чат уже оценён за выбранную дату"
              >
                ✓ ОЦЕНЕНО
              </span>
            )}
            <span
              className="text-gray-600 text-xs truncate min-w-0 flex-1"
              title={chat.chat_name}
            >
              {chat.chat_name}
            </span>
            {isTelegramLink(chat.chat_link) ? (
              <a
                href={tgHref(chat.chat_link!, tgClient)}
                target={tgWindowFor(chat.chat_link!)}
                rel="noreferrer"
                className="text-blue-600 hover:underline text-xs whitespace-nowrap"
                title="Открыть чат в одной вкладке Telegram (быстро)"
              >
                Открыть ↗
              </a>
            ) : /whatsapp/i.test(chat.chat_link ?? "") ? (
              <span
                className="text-gray-400 text-xs whitespace-nowrap"
                title="Клиент в WhatsApp — бот не отслеживает этот чат, активность недоступна"
              >
                WhatsApp
              </span>
            ) : (
              <span
                className="text-gray-400 text-xs whitespace-nowrap"
                title="Нет рабочей ссылки на Telegram-чат — проверьте ссылку в карточке"
              >
                нет ссылки
              </span>
            )}
            {chat.status !== "Active" && (
              <span className="text-xs text-gray-400 whitespace-nowrap">(неактивен)</span>
            )}
            {hideControl &&
              (hideControl.hidden ? (
                <button
                  onClick={hideControl.onToggle}
                  className="inline-flex items-center gap-1 text-emerald-600 hover:underline text-xs whitespace-nowrap"
                  title="Вернуть чат в список «Активные за день»"
                >
                  ↩ Вернуть
                </button>
              ) : (
                <button
                  onClick={hideControl.onToggle}
                  aria-label="Убрать чат из «Активные за день»"
                  title="Убрать этот чат из списка «Активные за день» на этот день (неважный чат)"
                  className="inline-flex items-center justify-center rounded p-1 text-gray-400 hover:text-red-600 hover:bg-red-50"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M3 6h18" />
                    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6" />
                    <path d="M14 11v6" />
                  </svg>
                </button>
              ))}
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
            {chat.unanswered === true && (
              <span
                className="ml-1.5 inline-block rounded bg-orange-500 text-white font-semibold px-1.5 py-0.5 whitespace-nowrap"
                title="Последним написал клиент — чат ждёт ответа (в т.ч. со вчерашнего дня)"
              >
                ⏳ ждёт ответа
                {waitingLabel(chat.last_activity_at, asOf)
                  ? ` · ${waitingLabel(chat.last_activity_at, asOf)!.replace("ждёт ", "")}`
                  : ""}
              </span>
            )}
          </div>
          {/* Debt signal. The payment state is filled AUTOMATICALLY from the
              Import Debts feed so Margarita never maintains it by hand: a client
              who still owes shows a red «Не уплачено» + amount; a client with
              nothing outstanding gets the auto «Нет долга» status. She only
              judges the follow-up («1-й написал» …) from the chat itself. */}
          {(() => {
            const amount = debtAmountLabel(chat.debts);
            const status = monthly["debts"]?.status?.trim() || "";
            const tone = debtTone(status);
            if (!amount?.owed && !tone) return null;
            const toneCls =
              tone === "fail"
                ? "bg-red-100 text-red-700"
                : tone === "none"
                ? "bg-gray-100 text-gray-500"
                : "bg-amber-100 text-amber-700";
            return (
              <div className="text-xs mt-1 flex flex-wrap items-center gap-1">
                {amount?.owed && (
                  <span
                    className="inline-block rounded px-1.5 py-0.5 font-medium bg-red-100 text-red-700"
                    title="Долг по данным импорта — клиент ещё не оплатил (обновляется из таблицы долгов)"
                  >
                    Не уплачено: {amount.text.replace(/^долг\s*/i, "")}
                  </span>
                )}
                {tone && (
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 font-medium ${toneCls}`}
                    title="Статус по долгам из последней проверки (см. колонку «Долги»)"
                  >
                    Долги: {status}
                  </span>
                )}
              </div>
            );
          })()}
          <div className="mt-1">
            <PersonPicker
              value={accountant}
              options={accountants.map((a) => a.name)}
              placeholder="— бухгалтер —"
              onChange={setAccountant}
            />
          </div>
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
      <tr className={savedId ? "bg-green-100" : "bg-blue-50/40"}>
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
            className={`!px-3 !py-1 text-xs ${
              savedId ? "btn-secondary !text-green-700 !border-green-500" : "btn-primary"
            }`}
            onClick={save}
            disabled={saving}
          >
            {saving ? "Сохраняю…" : savedId ? "✓ Сохранено · изменить" : "Оценить"}
          </button>
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
  // Span the accountant criteria columns (Точн/СЛА + 4 monthly) with the three
  // penalty inputs, so this role's row stays aligned with the grid.
  const critColSpan = DAILY_CRITERIA.length + MONTHLY_CATEGORIES.length;

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
    <tr className={savedId ? "bg-green-50/50" : "bg-violet-50/30"}>
      {/* Role + person — sits in the first column (scrolls with the grid). */}
      <td className="bg-white align-top min-w-[210px]">
        <div className="flex items-start gap-1.5">
          <span className="pt-1" title={info.label}>{info.icon}</span>
          <PersonPicker
            value={person}
            options={people}
            placeholder={`— ${info.label.toLowerCase()} —`}
            onChange={setPerson}
          />
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
          className={`!px-3 !py-1 text-xs ${
            savedId ? "btn-secondary !text-green-700 !border-green-500" : "btn-primary"
          }`}
          onClick={save}
          disabled={saving}
        >
          {saving ? "Сохраняю…" : savedId ? "✓ Сохранено · изменить" : "Оценить"}
        </button>
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
  hideControl = null,
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
  hideControl?: HideControl;
}) {
  const [showManager, setShowManager] = useState(Boolean(managerEval));
  const [showLawyer, setShowLawyer] = useState(Boolean(lawyerEval));
  const totalCols = DAILY_CRITERIA.length + MONTHLY_CATEGORIES.length + 6;

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
        hideControl={hideControl}
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
          <td colSpan={totalCols} className="py-1.5 pl-2 bg-amber-50/50">
            <span className="text-xs text-gray-600 font-medium mr-2">
              + оценить ещё в этом чате:
            </span>
            {!showManager && (
              <button
                className="btn-secondary !px-2 !py-0.5 text-xs mr-2"
                onClick={() => setShowManager(true)}
                title="Добавить отдельную оценку менеджеру в этом же чате"
              >
                👔 Менеджер
              </button>
            )}
            {!showLawyer && (
              <button
                className="btn-secondary !px-2 !py-0.5 text-xs"
                onClick={() => setShowLawyer(true)}
                title="Добавить отдельную оценку юристу в этом же чате"
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

/**
 * Person dropdown with a built-in "✏️ Другое…" option: pick a known name, or
 * choose Другое to type a custom one (used for бухгалтер / менеджер / юрист).
 */
function PersonPicker({
  value,
  options,
  placeholder,
  onChange,
}: {
  value: string;
  options: string[];
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  // "Other" mode whenever the current value isn't one of the known options
  // (covers a custom name loaded from a saved evaluation).
  const inList = value !== "" && options.includes(value);
  const [other, setOther] = useState(value !== "" && !inList);

  return (
    <div className="w-full space-y-1">
      <select
        className="input w-full text-xs"
        value={other ? "__other__" : value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__other__") {
            setOther(true);
            onChange("");
          } else {
            setOther(false);
            onChange(v);
          }
        }}
      >
        <option value="">{placeholder ?? "—"}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        <option value="__other__">✏️ Другое…</option>
      </select>
      {other && (
        <input
          className="input w-full text-xs"
          placeholder="впишите имя"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
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
