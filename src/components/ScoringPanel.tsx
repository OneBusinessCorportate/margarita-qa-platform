"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DAILY_CRITERIA,
  MONTHLY_CATEGORIES,
  PREV_STATUS_DEFAULT,
  canonicalMonthlyStatus,
  computeOverall,
  daysBetween,
  isStaleActivity,
  mailingPeriodOf,
  reviewDayForActivity,
  reviewDayOf,
  roleInfo,
  type CriteriaScores,
  type CriterionId,
  type EvalRole,
} from "@/lib/scoring";
import { predictEvaluation, toSnapshot, type AiModel } from "@/lib/ai";
import { reviewStatusFor, confidenceDisplay, type ConfidenceTone } from "@/lib/confidence";
import {
  SORT_OPTIONS,
  autoMonthlyStatus,
  cmpAgrNo,
  compareByActivity,
  debtAmountLabel,
  hasNewMessageAfterEval,
  isNewChat,
  isTelegramLink,
  latestActivityKey,
  matchesChatQuery,
  resolveChatTokens,
  splitContractQuery,
  splitQueryTokens,
  waitingLabel,
  type SortBy,
} from "@/lib/chat-list";
import type {
  Accountant,
  ActiveExclusion,
  ActiveInclusion,
  Chat,
  ChatMailing,
  Evaluation,
  MonthlyStatus,
  ScoreOverride,
} from "@/lib/types";
import BandChip from "./BandChip";
import CopyButton from "./CopyButton";
import ViolationModal from "./ViolationModal";
import TaskModal from "./TaskModal";

/** A stored mailing status for one category: value + where it came from. */
type MailingCell = {
  status: string;
  source: ChatMailing["source"];
  /** Relevant mailing date: confirmed_at ?? detected_at (not "today"). */
  at?: string | null;
};

// The "рассылка выполнена" status the detector emits per рассылка-category.
// When a message-confirmed рассылка is detected AFTER a row was already saved
// with a weaker status, we auto-lift the saved cell to this value so QA never
// has to change «Получил» by hand (Маргарита, п.1). «Долги» is intentionally
// excluded — that column is driven by the OneBusiness debt feed, not рассылки.
const MAILING_DONE_STATUS: Record<string, string> = {
  main_taxes: "Отправил",
  salary: "Получил",
  primary_docs: "Получил",
};

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

/** Control shown in "all" scope: add a chat to today's review day. */
type AddToReviewControl = { included: boolean; onAdd: () => void } | null;

export default function ScoringPanel({
  chats,
  accountants,
  initialEvaluations,
  aiModel,
  taskActivity = [],
  chatActivity = [],
  latestActivityDate = null,
  initialExclusions = [],
  initialInclusions = [],
  detectedMailings = [],
  initialScoreOverrides = [],
}: {
  chats: Chat[];
  accountants: Accountant[];
  initialEvaluations: Evaluation[];
  aiModel: AiModel;
  taskActivity?: { chat_agr_no: string; date: string }[];
  chatActivity?: { chat_agr_no: string; date: string; at?: string | null }[];
  latestActivityDate?: string | null;
  initialExclusions?: ActiveExclusion[];
  initialInclusions?: ActiveInclusion[];
  detectedMailings?: ChatMailing[];
  initialScoreOverrides?: ScoreOverride[];
}) {
  const router = useRouter();
  const [evaluations, setEvaluations] = useState<Evaluation[]>(initialEvaluations);
  // Manual per-day score overrides (п.8), newest first; local so a new edit
  // shows immediately without a full reload.
  const [scoreOverrides, setScoreOverrides] =
    useState<ScoreOverride[]>(initialScoreOverrides);
  const [date, setDate] = useState(latestActivityDate ?? today());
  // Default to the day view: Margarita works through one day's chats in time
  // order, bottom-to-top. "All active chats" stays a click away.
  const [scope, setScope] = useState<Scope>("day");
  const [sortBy, setSortBy] = useState<SortBy>("activity");
  const [search, setSearch] = useState("");
  const [accFilters, setAccFilters] = useState<string[]>([]);
  const [onlyUnscored, setOnlyUnscored] = useState(false);
  // Complement of onlyUnscored: show ONLY chats already rated for this date.
  // The two are mutually exclusive (toggling one clears the other).
  const [onlyRated, setOnlyRated] = useState(false);
  const [activeOnly, setActiveOnly] = useState(true);
  const [hideStale, setHideStale] = useState(false);
  // Default to the link's NATIVE "A" client. Rewriting the stored web.telegram.org/a/
  // links to the "K" client changed the URL the app expects and made some chats
  // open EMPTY ("some chats are empty when she clicks to Telegram"). The big speed
  // win is reusing ONE Telegram tab (below), which works on either client — so we
  // keep the reliable native client and let QA opt into K via the toggle.
  const [tgClient, setTgClient] = useState<TgClient>("a");
  // Chats QA manually hid from "Активные за день", keyed `${agr_no}|${date}`.
  const [excluded, setExcluded] = useState<Set<string>>(
    () => new Set(initialExclusions.map((e) => `${e.chat_agr_no}|${e.exclude_date}`))
  );
  // Chats QA manually ADDED to "Активные за день" (item 5 / "ручное добавление в
  // QA"), keyed `${agr_no}|${date}` — the mirror of `excluded`.
  const [included, setIncluded] = useState<Set<string>>(
    () => new Set(initialInclusions.map((e) => `${e.chat_agr_no}|${e.include_date}`))
  );
  // The chat whose «Нарушение» popup is open (boss's request — log a violation
  // without leaving QA). null = closed.
  const [violationFor, setViolationFor] = useState<Chat | null>(null);
  // The chat whose «Задача» popup is open — add a task without leaving QA.
  const [taskFor, setTaskFor] = useState<Chat | null>(null);
  // Chats the user deleted this session — removed from the list immediately
  // without waiting for a server refresh.
  const [deletedChatNos, setDeletedChatNos] = useState<Set<string>>(new Set());
  // "Добавить чат в QA" search box (open + query + busy/error for create-by-link).
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [detectingMailings, setDetectingMailings] = useState(false);
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

  // Switch Telegram web client (A native / K faster) and remember the choice.
  function chooseTgClient(c: TgClient) {
    setTgClient(c);
    try {
      window.localStorage.setItem("qa_tg_client", c);
    } catch {
      /* ignore storage errors */
    }
  }

  // Trigger a mailing detection scan for the current month, then refresh.
  async function runMailingDetect() {
    setDetectingMailings(true);
    try {
      const res = await fetch("/api/mailings/detect", { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(`Не удалось запустить распознавание рассылок: ${d.error || res.status}`);
        return;
      }
      router.refresh();
    } catch {
      alert("Сетевая ошибка при распознавании рассылок");
    } finally {
      setDetectingMailings(false);
    }
  }

  // Keep the day view current WITHOUT a manual reload. Next.js serves a stale
  // (pre-fetched) copy from its client Router Cache on navigation, so we refresh
  // IMMEDIATELY on mount — otherwise «правильные данные появлялись только после
  // нескольких обновлений» (жалоба QA) — again whenever the tab regains focus
  // (она отвечает клиенту в Telegram и возвращается на вкладку → статус «Ждёт
  // ответа» и оценки подтягиваются сразу), and on a short background interval.
  useEffect(() => {
    // Жалоба QA «частые обновления страницы»: раньше список обновлялся каждые
    // 5 минут И при КАЖДОМ возврате фокуса (её рабочий цикл — ответить в Telegram
    // и вернуться), из-за чего страница «дёргалась» постоянно. Теперь:
    //   • немедленный refresh на монтировании остаётся (заменяем устаревший
    //     Router Cache — иначе «данные только после нескольких обновлений»);
    //   • обновления по фокусу/видимости и по таймеру ограничены throttle —
    //     не чаще одного раза в 2 минуты;
    //   • фоновый интервал увеличен с 5 до 40 минут (как и обещает подсказка на
    //     кнопке «Обновить»). Свежесть по-прежнему обеспечивает возврат фокуса.
    let lastRefresh = 0;
    const MIN_GAP_MS = 2 * 60 * 1000;
    const refresh = (force = false) => {
      if (typeof document !== "undefined" && document.hidden) return;
      const now = Date.now();
      if (!force && now - lastRefresh < MIN_GAP_MS) return;
      lastRefresh = now;
      router.refresh();
    };
    refresh(true); // немедленно на монтировании — заменяем устаревший Router Cache
    const id = setInterval(() => refresh(), 40 * 60 * 1000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [router]);

  // router.refresh() re-runs the (force-dynamic) server component and streams
  // fresh props, but evaluations / overrides live in local state seeded ONCE, so
  // without syncing them a refresh silently changed nothing — the root cause of
  // «оценённые чаты снова показывают „Оценить"» и «данные видны только после
  // нескольких обновлений». Sync from props so a refresh actually updates what
  // QA sees. Local optimistic edits (onSaved) are already persisted to the DB,
  // so the fresh server payload includes them — nothing is lost.
  useEffect(() => {
    setEvaluations(initialEvaluations);
  }, [initialEvaluations]);
  useEffect(() => {
    setScoreOverrides(initialScoreOverrides);
  }, [initialScoreOverrides]);

  // Several contracts can share ONE Telegram chat (a client with multiple
  // agreements all talk in one group). Merge them into a single representative
  // row so the same conversation isn't reviewed twice. The representative is the
  // lowest contract № (stable across loads); `mergedAgrs` carries the others,
  // `repOf` maps every contract → its representative, and the merged chat folds
  // in the group's activity / unanswered / debt so the row stays in the day view
  // whichever contract was active. Chats without a real Telegram link are never
  // merged (each keeps its own row).
  const { mergedChats, repOf, mergedAgrs } = useMemo(() => {
    const groups = new Map<string, Chat[]>();
    for (const c of chats) {
      const link = (c.chat_link ?? "").trim();
      const k = isTelegramLink(link) ? `tg:${link}` : `id:${c.agr_no}`;
      const arr = groups.get(k) ?? [];
      arr.push(c);
      groups.set(k, arr);
    }
    const pickMax = (xs: (string | null | undefined)[]) => {
      let best: string | null = null;
      for (const x of xs) if (x && (best === null || x > best)) best = x;
      return best;
    };
    const pickMin = (xs: (string | null | undefined)[]) => {
      let best: string | null = null;
      for (const x of xs) if (x && (best === null || x < best)) best = x;
      return best;
    };
    const mergedChats: Chat[] = [];
    const repOf = new Map<string, string>();
    const mergedAgrs = new Map<string, string[]>();
    for (const g of groups.values()) {
      const sorted = [...g].sort((a, b) => cmpAgrNo(a.agr_no, b.agr_no));
      const repChat = sorted[0];
      for (const c of sorted) repOf.set(c.agr_no, repChat.agr_no);
      if (sorted.length === 1) {
        mergedChats.push(repChat);
        continue;
      }
      const others = sorted.slice(1).map((c) => c.agr_no);
      mergedAgrs.set(repChat.agr_no, others);
      const owed = sorted.find((c) => debtAmountLabel(c.debts)?.owed);
      mergedChats.push({
        ...repChat,
        last_activity_date: pickMax(sorted.map((c) => c.last_activity_date)),
        last_activity_at: pickMax(sorted.map((c) => c.last_activity_at)),
        created_date: pickMin(sorted.map((c) => c.created_date)),
        unanswered: sorted.some((c) => c.unanswered === true) ? true : repChat.unanswered,
        status: sorted.some((c) => c.status === "Active") ? "Active" : repChat.status,
        debts: owed?.debts ?? repChat.debts,
      });
    }
    return { mergedChats, repOf, mergedAgrs };
  }, [chats]);

  // Index the stored mailing statuses (mqa_chat_mailings) for O(1) lookup,
  // filtered to the selected date's рассылки cycle (rolls over on the 28th, so
  // a date on/after the 28th shows the NEXT cycle) and folded onto the
  // REPRESENTATIVE chat of a merged group — auto-detection can store a row
  // under any of the contracts sharing one Telegram chat. Manual (QA-confirmed)
  // rows always win over auto-detected ones; the source travels along so the
  // row UI can show 📌 for a manually saved status.
  const mailingsByChat = useMemo(() => {
    const selectedPeriod = mailingPeriodOf(date);
    const m = new Map<string, Record<string, MailingCell>>();
    for (const row of detectedMailings) {
      if (row.period !== selectedPeriod) continue;
      const key = repOf.get(row.agr_no) ?? row.agr_no;
      if (!m.has(key)) m.set(key, {});
      const cats = m.get(key)!;
      const cur = cats[row.category];
      if (cur && cur.source === "manual" && row.source !== "manual") continue;
      cats[row.category] = {
        status: row.status,
        source: row.source,
        at: row.confirmed_at ?? row.detected_at ?? null,
      };
    }
    return m;
  }, [detectedMailings, date, repOf]);

  // Latest manual score override per (chat, selected date) — п.8. Keyed by the
  // chat's agr_no; the Row shows the «изменено вручную» marker + edit control.
  const overrideByChatDate = useMemo(() => {
    const m = new Map<string, ScoreOverride>();
    for (const o of scoreOverrides) {
      if (o.score_date.slice(0, 10) !== date) continue;
      const cur = m.get(o.chat_agr_no);
      if (!cur || o.created_at > cur.created_at) m.set(o.chat_agr_no, o);
    }
    return m;
  }, [scoreOverrides, date]);

  // Record a just-saved override locally so the marker appears immediately.
  function onScoreOverrideSaved(o: ScoreOverride) {
    setScoreOverrides((prev) => [o, ...prev]);
    // Refresh server components (dashboard/report read the override) in the bg.
    router.refresh();
  }

  // The most recent check BEFORE the selected date — carried forward so
  // Margarita only changes what actually changed. Keyed by the representative
  // contract so a prior check saved under any contract in the group carries
  // forward. Mailing statuses are cycle-scoped: they carry ONLY within the
  // same рассылки cycle (28th → 27th). Every 28th the cycle resets — every
  // рассылка goes back to «Предстоящая» (waiting) until the message scan or
  // Margarita fills it, instead of last cycle's «Получил» leaking into the
  // new one. Criteria and the comment still carry across cycles.
  const prevByChat = useMemo(() => {
    const latestBefore = new Map<string, Evaluation>();
    for (const e of evaluations) {
      if ((e.role ?? "accountant") !== "accountant") continue;
      if (e.checking_date.slice(0, 10) >= date) continue;
      const key = repOf.get(e.chat_agr_no) ?? e.chat_agr_no;
      const cur = latestBefore.get(key);
      if (!cur || e.checking_date > cur.checking_date) latestBefore.set(key, e);
    }
    const selectedCycle = mailingPeriodOf(date);
    const out = new Map<string, PrevCheck>();
    for (const [chatNo, e] of latestBefore) {
      const sameCycle = mailingPeriodOf(e.checking_date.slice(0, 10)) === selectedCycle;
      const monthly: Record<string, string> = {};
      if (sameCycle) {
        for (const cat of MONTHLY_CATEGORIES) {
          const s = e.scores.monthly?.[cat.id]?.status;
          if (s) monthly[cat.id] = s;
        }
      }
      out.set(chatNo, {
        date: e.checking_date.slice(0, 10),
        monthly,
        criteria: e.scores.criteria ?? {},
        comment: e.comment ?? "",
      });
    }
    return out;
  }, [evaluations, date, repOf]);

  // Last REAL chat activity per chat: the chat's own activity date (from the bot
  // feed / import) or, failing that, the latest task touch. Evaluations don't
  // count — checking a chat isn't the client/accountant being active in it.
  // Keyed by representative so a task on any merged contract counts.
  const lastTaskByChat = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of taskActivity) {
      if (!t.date) continue;
      const key = repOf.get(t.chat_agr_no) ?? t.chat_agr_no;
      const cur = m.get(key);
      if (!cur || t.date > cur) m.set(key, t.date);
    }
    return m;
  }, [taskActivity, repOf]);

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
      if (e.checking_date.slice(0, 10) === date)
        m.set(repOf.get(e.chat_agr_no) ?? e.chat_agr_no, e);
    }
    return m;
  }, [evaluations, date, repOf]);

  // Every role's evaluation for the date, keyed `${repChat}|${role}` — so each
  // chat group can show the accountant, manager and lawyer rows together, even
  // when the saved evaluation was filed under a merged sibling contract.
  const evalByChatRole = useMemo(() => {
    const m = new Map<string, Evaluation>();
    for (const e of evaluations) {
      if (e.checking_date.slice(0, 10) !== date) continue;
      const key = repOf.get(e.chat_agr_no) ?? e.chat_agr_no;
      m.set(`${key}|${e.role ?? "accountant"}`, e);
    }
    return m;
  }, [evaluations, date, repOf]);

  // People suggestions for the manager / lawyer pickers. Managers come from the
  // chats' own manager field + non-accountant specialists; both grow from names
  // already used in saved role-evaluations.
  const managers = useMemo(() => {
    const s = new Set<string>();
    for (const c of mergedChats) if (c.manager) s.add(c.manager);
    for (const a of accountants) if (a.role !== "accountant") s.add(a.name);
    for (const e of evaluations)
      if (e.role === "manager" && e.accountant) s.add(e.accountant);
    return [...s].sort();
  }, [mergedChats, accountants, evaluations]);

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
    const rep = (a: string) => repOf.get(a) ?? a;
    // Bucket activity by its REVIEW day, not its raw date: weekend / RA-holiday
    // activity rolls onto the next working day (e.g. Sat+Sun → Monday), since QA
    // isn't done on non-working days. A working day maps to itself, so weekday
    // behaviour is unchanged. reviewDayOf is memoised-cheap (pure).
    for (const a of chatActivity)
      if (reviewDayForActivity(a.at, a.date) === date) s.add(rep(a.chat_agr_no));
    for (const c of mergedChats) {
      const la = lastActivityFor(c);
      if (la && reviewDayForActivity(c.last_activity_at, la) === date)
        s.add(c.agr_no);
    }
    for (const t of taskActivity)
      if (t.date && reviewDayOf(t.date) === date) s.add(rep(t.chat_agr_no));
    // Backlog: chats where the CLIENT had the last word (still unanswered) stay
    // in the day view even if their last message was on an earlier day, so the
    // "start from the bottom unanswered chat" workflow can reach yesterday's.
    for (const c of mergedChats) if (c.unanswered === true) s.add(c.agr_no);
    // Brand-new chats created on the reviewed day appear even before they have
    // any message activity captured in the feed (item 6). Created on a
    // non-working day → reviewed on the next working day, same as activity.
    for (const c of mergedChats) {
      const cd = (c.created_date ?? "").slice(0, 10);
      if (cd && reviewDayOf(cd) === date) s.add(c.agr_no);
    }
    // Chats Margarita pulled in by hand for this day (item 5 / "ручное
    // добавление в QA") — surfaced even if the feed never reported them active.
    for (const c of mergedChats) if (included.has(`${c.agr_no}|${date}`)) s.add(c.agr_no);
    // Chats already RATED on the selected day: so a PAST-day evaluation can be
    // found and re-opened for editing even when the chat had no new activity
    // that day (item 8 — «изменить оценку чата за предыдущий день»). Without
    // this, yesterday's rated-but-quiet chats vanished from the day view and
    // her score couldn't be corrected.
    for (const agr of evalForDate.keys()) s.add(agr);
    return s;
  }, [chatActivity, mergedChats, lastActivityFor, taskActivity, date, repOf, included, evalForDate]);

  // Precise activity time for a chat ON the selected day (from the per-day feed),
  // so the day view sorts by when the chat was actually active that day — not by
  // the chat's most-recent activity across all days (which looked random). Keyed
  // by representative so a merged sibling's message time orders the merged row.
  const activityAtForDay = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of chatActivity) {
      if (reviewDayForActivity(a.at, a.date) !== date || !a.at) continue;
      const key = repOf.get(a.chat_agr_no) ?? a.chat_agr_no;
      const cur = m.get(key);
      if (!cur || a.at > cur) m.set(key, a.at);
    }
    return m;
  }, [chatActivity, date, repOf]);

  const isHidden = (agrNo: string) => excluded.has(`${agrNo}|${date}`);
  const isIncluded = (agrNo: string) => included.has(`${agrNo}|${date}`);

  // Manually add / remove a chat to "Активные за день" for the selected day.
  // Optimistic, with a background persist that reverts on failure — same shape
  // as setChatHidden. Adding also clears any same-day exclusion so the chat
  // can't be both hidden and added.
  async function setChatIncluded(agrNo: string, include: boolean) {
    const key = `${agrNo}|${date}`;
    setIncluded((s) => {
      const next = new Set(s);
      if (include) next.add(key);
      else next.delete(key);
      return next;
    });
    if (include && excluded.has(key)) setChatHidden(agrNo, false);
    try {
      const res = await fetch("/api/active-inclusions", {
        method: include ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agr_no: agrNo, date }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setIncluded((s) => {
        const next = new Set(s);
        if (include) next.delete(key);
        else next.add(key);
        return next;
      });
    }
  }

  // The "add to QA" box runs in two modes:
  //  • single token  → search-as-you-type list of matching chats not yet shown.
  //  • multiple tokens (lines / commas — e.g. several pasted Telegram links) →
  //    bulk: resolve each token to a chat and offer "add all", listing any that
  //    aren't in the system (item 6 — tells her which chats are missing).
  const addTokens = useMemo(() => splitQueryTokens(addQuery), [addQuery]);
  const bulkMode = addTokens.length > 1;

  const addCandidates = useMemo(() => {
    const q = addQuery.trim();
    if (bulkMode || !q) return [];
    return mergedChats
      .filter((c) => !activeTodaySet.has(c.agr_no) && matchesChatQuery(c, q))
      .slice(0, 12);
  }, [mergedChats, addQuery, activeTodaySet, bulkMode]);

  const bulkResolved = useMemo(
    () => (bulkMode ? resolveChatTokens(mergedChats, addQuery) : null),
    [bulkMode, mergedChats, addQuery]
  );

  function addManyToQa(agrNos: string[]) {
    for (const agr of agrNos) setChatIncluded(agr, true);
    setAddOpen(false);
    setAddQuery("");
  }

  // Create a chat from a pasted Telegram link (chat missing from the system)
  // and pull it into this day's list — then refresh so the new row renders.
  // Accepts several links; creates them all before a single refresh.
  async function createFromLinks(links: string[]) {
    if (links.length === 0) return;
    setAddBusy(true);
    setAddError(null);
    try {
      for (const link of links) {
        const res = await fetch("/api/chats/from-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ link, date }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || "Не удалось создать чат");
        }
      }
      setAddOpen(false);
      setAddQuery("");
      router.refresh();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setAddBusy(false);
    }
  }

  // Create a chat by its contract № (п.3) — for chats present in «КК
  // Сопровождения» / «Налоговый кабинет» but missing from «Основные данные», so
  // the add-box no longer dead-ends at «Ничего не найдено». Keeps the pasted
  // label as the chat name and pulls the chat into this day's list.
  async function createByNumber(query: string) {
    const { agr_no, name } = splitContractQuery(query);
    if (!agr_no) return;
    setAddBusy(true);
    setAddError(null);
    try {
      const res = await fetch("/api/chats/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agr_no, name, date }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Не удалось создать чат");
      }
      setAddOpen(false);
      setAddQuery("");
      router.refresh();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setAddBusy(false);
    }
  }

  // How many of the day's active chats QA has hidden (drives the "Скрытые (N)"
  // toggle). Only meaningful in the day view.
  const hiddenCount = useMemo(() => {
    let n = 0;
    for (const agr of activeTodaySet) if (excluded.has(`${agr}|${date}`)) n += 1;
    return n;
  }, [activeTodaySet, excluded, date]);

  const visibleChats = useMemo(() => {
    const n = search.trim().toLowerCase();
    return mergedChats.filter((c) => {
      // Chats deleted this session vanish immediately.
      if (deletedChatNos.has(c.agr_no)) return false;
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
      // scope honours the status flag — AND only when there is no explicit
      // search. An Inactive chat (п.3/п.7: B-4061/B-4206 и т.п.) must still be
      // findable when Маргарита searches it by № / имени / ссылке, otherwise the
      // add-box shows «Ничего не найдено» for a chat that DOES exist; it then
      // surfaces with the 🚫 «Неактивный» badge so its status is unambiguous.
      if (activeOnly && scope === "all" && c.status !== "Active" && !n) return false;
      if (hideStale && isStaleActivity(lastActivityFor(c), nowISO)) return false;
      if (accFilters.length && !(c.accountant && accFilters.includes(c.accountant)))
        return false;
      if (onlyUnscored && evalForDate.has(c.agr_no)) return false;
      if (onlyRated && !evalForDate.has(c.agr_no)) return false;
      // Free-text search incl. a pasted Telegram link: matchesChatQuery matches
      // №, chat name, agreement name, the raw chat link AND the Telegram chat id
      // (so an /a/, /k/ or t.me link all find the chat). Plus a merged sibling's
      // contract № so any of the contracts sharing the chat finds the row.
      if (
        n &&
        !matchesChatQuery(c, search) &&
        !(mergedAgrs.get(c.agr_no) ?? []).some((a) => a.toLowerCase().includes(n))
      )
        return false;
      return true;
    });
  }, [mergedChats, mergedAgrs, search, accFilters, onlyUnscored, onlyRated, activeOnly, hideStale, lastActivityFor, nowISO, evalForDate, scope, activeTodaySet, excluded, date, showHidden, deletedChatNos]);

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
        onlyRated,
        showHidden,
        accFilters,
        search,
      ]),
    [scope, date, sortBy, activeOnly, hideStale, onlyUnscored, onlyRated, showHidden, accFilters, search]
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
      // Take the LATEST of every source we have (per-day feed `last_at`, the
      // chat's own timestamp, the activity date) so a precise time always wins
      // over a coarse same-day date — otherwise same-day chats tied on the date
      // and fell back to contract-№, looking alphabetical rather than ordered by
      // activity.
      const key = (c: Chat) =>
        latestActivityKey(
          scope === "day" ? activityAtForDay.get(c.agr_no) : undefined,
          c.last_activity_at,
          lastActivityFor(c)
        );
      arr.sort((a, b) => compareByActivity(a, b, key));
      return arr;
    }
    // "worst": problem chats on top, by saved total or the AI's predicted total.
    const scoreFor = (c: Chat): number => {
      const ev = evalForDate.get(c.agr_no);
      if (ev) return ev.total_score;
      return predictEvaluation(c.accountant, prevByChat.get(c.agr_no)?.monthly ?? {}, aiModel, {
        status: c.status,
        debts: c.debts,
        debtStatus: c.debt_status,
        date,
      }).total;
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
  }, [search, accFilters, onlyUnscored, onlyRated, activeOnly, hideStale, scope, date, sortBy]);

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
    <div className="flex flex-col gap-2 flex-1 min-h-0">
      {/* Top bar — title, scope toggle and live counts on the left; actions
          (Telegram, refresh, hidden, client picker) pushed to the right. One
          aligned row so the grid keeps the most vertical space. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-base font-semibold text-gray-900">Оценка чатов</h1>
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

        {/* At-a-glance counts. */}
        <span className="inline-block rounded bg-blue-50 text-blue-700 font-medium text-xs px-2 py-1">
          Активных за {date}: {Math.max(0, activeTodaySet.size - hiddenCount)}
        </span>
        <span className="inline-block rounded bg-green-50 text-green-700 font-medium text-xs px-2 py-1">
          ✓ Оценено за {date}: {evalForDate.size}
        </span>

        {/* Actions — Telegram, refresh, hidden toggle, client picker. */}
        <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
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
          <button
            className="btn-secondary"
            onClick={runMailingDetect}
            disabled={detectingMailings}
            title="Сканировать сообщения бухгалтеров за текущий месяц и обновить статусы рассылок (налоги / ЗП / первичка / долги)"
          >
            {detectingMailings ? "Сканирую…" : "Рассылки ↺"}
          </button>
          <span
            className="text-[11px] text-gray-500"
            title="Под каждым статусом рассылки в строке чата появляется авто-распознанное из сообщений бухгалтера значение. 🔍 — нажмите, чтобы применить; ✓ — уже совпадает."
          >
            🔍 авто-рассылки
          </span>
          {scope === "day" && (hiddenCount > 0 || showHidden) && (
            <button
              className="btn-secondary"
              onClick={() => setShowHidden((v) => !v)}
              title="Чаты, вручную скрытые из списка «Активные за день». Нажмите, чтобы показать и при необходимости вернуть."
            >
              {showHidden ? "Скрыть скрытые" : `Скрытые за день (${hiddenCount})`}
            </button>
          )}
          {/* A/K client picker: A is the native, reliable client (some chats opened
              empty on K); K loads a bit faster. Choice is remembered. */}
          <span
            className="inline-flex rounded-lg border border-gray-300 overflow-hidden text-xs"
            title="Клиент Telegram Web. «A» — родной для ссылок, открывает чаты надёжно. «K» — быстрее грузится, но иногда чат пустой. Выбор запоминается."
          >
            <span className="px-2 py-1.5 text-gray-500 bg-gray-50">TG:</span>
            <button
              onClick={() => chooseTgClient("a")}
              className={`px-2 py-1.5 font-medium ${
                tgClient === "a" ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              A
            </button>
            <button
              onClick={() => chooseTgClient("k")}
              className={`px-2 py-1.5 font-medium border-l border-gray-300 ${
                tgClient === "k" ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              K
            </button>
          </span>
        </div>
      </div>

      {/* Filter toolbar */}
      <div className="card p-2 flex flex-wrap items-end gap-x-3 gap-y-2">
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
          <label className="text-xs text-gray-500 block">
            Поиск чата (№ / название / ссылка Telegram)
          </label>
          <input
            className="input w-full"
            placeholder="напр. 59, Фролкин или вставьте ссылку Telegram"
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
            onChange={(e) => {
              setOnlyUnscored(e.target.checked);
              if (e.target.checked) setOnlyRated(false);
            }}
          />
          Только неоценённые
        </label>
        <label
          className="flex items-center gap-1.5 text-sm text-gray-600 pb-1.5"
          title="Показать только чаты, уже оценённые за выбранную дату"
        >
          <input
            type="checkbox"
            checked={onlyRated}
            onChange={(e) => {
              setOnlyRated(e.target.checked);
              if (e.target.checked) setOnlyUnscored(false);
            }}
          />
          Только оценённые
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

      {/* Manual "add chat to QA" (item 5 / boss: «функция ручного добавления в
          QA»). Available in both day and all-chats views — pull a chat into
          the QA list for the selected date. Search by № / название / вставленная ссылка Telegram. */}
      {(scope === "day" || scope === "all") && (
        <div className="card p-2">
          {!addOpen ? (
            <button
              className="btn-secondary text-sm"
              onClick={() => setAddOpen(true)}
              title="Добавить чат в список «Активные за день» вручную — по № договора, названию или ссылке Telegram"
            >
              ➕ Добавить чат в QA
            </button>
          ) : (
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <textarea
                  autoFocus
                  rows={addQuery.includes("\n") ? 4 : 1}
                  className="input grow resize-y min-h-[38px]"
                  placeholder="№ договора, название или ссылка Telegram. Несколько — по одной в строке."
                  value={addQuery}
                  onChange={(e) => setAddQuery(e.target.value)}
                />
                <button
                  className="btn-secondary text-sm"
                  onClick={() => {
                    setAddOpen(false);
                    setAddQuery("");
                  }}
                >
                  Закрыть
                </button>
              </div>

              {/* Bulk mode: several tokens pasted (e.g. her 5 Telegram links). */}
              {bulkMode && bulkResolved && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <button
                      className="btn-primary"
                      disabled={bulkResolved.matched.length === 0}
                      onClick={() =>
                        addManyToQa(bulkResolved.matched.map((m) => m.chat.agr_no))
                      }
                    >
                      ➕ Добавить все ({bulkResolved.matched.length})
                    </button>
                    {bulkResolved.unmatched.length > 0 && (
                      <span className="text-amber-700">
                        не найдено в системе: {bulkResolved.unmatched.length}
                      </span>
                    )}
                  </div>
                  {bulkResolved.matched.length > 0 && (
                    <div className="max-h-40 overflow-auto rounded-lg border border-gray-200 divide-y text-sm">
                      {bulkResolved.matched.map((m) => (
                        <div key={m.chat.agr_no} className="flex items-center gap-2 px-3 py-1.5">
                          <span className="font-medium whitespace-nowrap">№ {m.chat.agr_no}</span>
                          <span className="text-gray-600 truncate">{m.chat.chat_name}</span>
                          {activeTodaySet.has(m.chat.agr_no) && (
                            <span className="ml-auto text-xs text-green-600 whitespace-nowrap">
                              уже в списке
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {bulkResolved.unmatched.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-800 space-y-1.5">
                      <div className="font-medium">Этих чатов нет в системе:</div>
                      <ul className="space-y-0.5 break-all">
                        {bulkResolved.unmatched.map((t) => (
                          <li key={t}>• {t}</li>
                        ))}
                      </ul>
                      {bulkResolved.unmatched.some((t) => isTelegramLink(t)) && (
                        <button
                          className="btn-primary !py-1 !px-2 text-xs"
                          disabled={addBusy}
                          onClick={() =>
                            createFromLinks(
                              bulkResolved.unmatched.filter((t) => isTelegramLink(t))
                            )
                          }
                        >
                          {addBusy
                            ? "Создаю…"
                            : `➕ Создать из ссылок и добавить (${bulkResolved.unmatched.filter((t) => isTelegramLink(t)).length})`}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              {addError && <div className="text-sm text-red-600">{addError}</div>}

              {/* Single search-as-you-type. */}
              {!bulkMode && addQuery.trim() && (
                <div className="max-h-56 overflow-auto rounded-lg border border-gray-200 divide-y">
                  {addCandidates.length === 0 ? (
                    isTelegramLink(addQuery.trim()) ? (
                      <div className="px-3 py-2 text-sm text-gray-600 flex flex-wrap items-center gap-2">
                        <span>Чат с этой ссылкой не найден в системе.</span>
                        <button
                          className="btn-primary !py-1 !px-2 text-xs"
                          disabled={addBusy}
                          onClick={() => createFromLinks([addQuery.trim()])}
                        >
                          {addBusy ? "Создаю…" : "➕ Создать чат из ссылки и добавить"}
                        </button>
                      </div>
                    ) : (
                      <div className="px-3 py-2 text-sm text-gray-600 flex flex-wrap items-center gap-2">
                        <span>Ничего не найдено (или чат уже в списке за {date}).</span>
                        <button
                          className="btn-primary !py-1 !px-2 text-xs"
                          disabled={addBusy}
                          onClick={() => createByNumber(addQuery.trim())}
                          title="Создать чат по № договора (для чатов из «КК Сопровождения» / «Налоговый кабинет», которых нет в основной таблице)"
                        >
                          {addBusy
                            ? "Создаю…"
                            : `➕ Создать чат «${splitContractQuery(addQuery.trim()).agr_no}» и добавить`}
                        </button>
                      </div>
                    )
                  ) : (
                    addCandidates.map((c) => (
                      <button
                        key={c.agr_no}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-blue-50"
                        onClick={() => {
                          setChatIncluded(c.agr_no, true);
                          setAddOpen(false);
                          setAddQuery("");
                        }}
                      >
                        <span className="font-medium whitespace-nowrap">№ {c.agr_no}</span>
                        <span className="text-gray-600 truncate">{c.chat_name}</span>
                        {!isTelegramLink(c.chat_link) && (
                          <span className="ml-auto text-xs text-gray-400 whitespace-nowrap">
                            нет ссылки
                          </span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Scroll the wide grid inside its own box so the sticky HEADER ROW pins
          relative to THIS container. The box fills the remaining viewport
          height (flex-1), so the page never scrolls — only the grid does. The
          first column is intentionally NOT horizontally pinned — it scrolls
          with the grid. */}
      <div className="card overflow-auto flex-1 min-h-0">
        <table className="qa pairs sticky-head dense w-full">
          <thead>
            <tr>
              <th className="corner bg-gray-100 min-w-[150px]">
                № / Чат / Бухгалтер
              </th>
              <th className="text-center">Кто</th>
              {DAILY_CRITERIA.map((c) => (
                <th key={c.id} className="text-center" title={c.name}>
                  {c.id === "accuracy" ? "Точн." : "СЛА"}
                </th>
              ))}
              {MONTHLY_CATEGORIES.map((c) => (
                <th key={c.id} className="text-center" title={c.name}>
                  {c.shortName}
                </th>
              ))}
              <th className="text-center">Общая</th>
              <th className="text-center">Кач-во</th>
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
                // Include the saved-evaluation / override identity in the key so
                // that when a refresh brings fresh data (a chat now evaluated, or
                // a manual score override), the row REMOUNTS and re-seeds from it
                // — otherwise a row that mounted before the save keeps showing
                // «Оценить» and the old score («повторная проверка → снова
                // „Оценить"» / «критический чат показывает 100»). A re-save keeps
                // the same eval id, so it does not remount mid-edit.
                key={`${chat.agr_no}|${date}|${evalByChatRole.get(`${chat.agr_no}|accountant`)?.id ?? "n"}|${evalByChatRole.get(`${chat.agr_no}|manager`)?.id ?? "n"}|${overrideByChatDate.get(chat.agr_no)?.id ?? "n"}`}
                chat={chat}
                accountants={accountants}
                date={date}
                scope={scope}
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
                onLogViolation={() => setViolationFor(chat)}
                onLogTask={() => setTaskFor(chat)}
                onDeleted={(id) => setEvaluations((prev) => prev.filter((e) => e.id !== id))}
                onChatDeleted={(agrNo) =>
                  setDeletedChatNos((s) => new Set([...s, agrNo]))
                }
                manualAdded={scope === "day" && isIncluded(chat.agr_no)}
                onRemoveManual={() => setChatIncluded(chat.agr_no, false)}
                duplicateAgrs={mergedAgrs.get(chat.agr_no) ?? []}
                mailingRows={mailingsByChat.get(chat.agr_no) ?? {}}
                scoreOverride={overrideByChatDate.get(chat.agr_no) ?? null}
                onScoreOverrideSaved={onScoreOverrideSaved}
                hideControl={
                  scope === "day"
                    ? {
                        hidden: isHidden(chat.agr_no),
                        onToggle: () =>
                          setChatHidden(chat.agr_no, !isHidden(chat.agr_no)),
                      }
                    : null
                }
                addToReviewControl={
                  scope === "all"
                    ? {
                        included: isIncluded(chat.agr_no),
                        onAdd: () => setChatIncluded(chat.agr_no, true),
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

      {violationFor && (
        <ViolationModal
          chatAgrNo={violationFor.agr_no}
          client={violationFor.chat_name}
          accountant={violationFor.accountant ?? null}
          manager={violationFor.manager ?? null}
          chatLink={violationFor.chat_link ?? null}
          defaultDate={date}
          onClose={() => setViolationFor(null)}
        />
      )}
      {taskFor && (
        <TaskModal
          chatAgrNo={taskFor.agr_no}
          client={taskFor.chat_name}
          accountant={taskFor.accountant ?? null}
          manager={taskFor.manager ?? null}
          defaultDate={date}
          onClose={() => setTaskFor(null)}
        />
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
  managers = [],
  date,
  scope,
  existing,
  prev,
  lastActivity,
  asOf,
  aiModel,
  tgClient,
  onSaved,
  onDeleted,
  onChatDeleted,
  onLogViolation,
  onLogTask,
  manualAdded = false,
  onRemoveManual,
  duplicateAgrs = [],
  hideControl = null,
  addToReviewControl = null,
  mailingRows = {},
  scoreOverride = null,
  onScoreOverrideSaved,
}: {
  chat: Chat;
  accountants: Accountant[];
  managers?: string[];
  date: string;
  scope: Scope;
  existing: Evaluation | null;
  prev: PrevCheck | null;
  lastActivity: string | null;
  asOf: string;
  aiModel: AiModel;
  tgClient: TgClient;
  onSaved: (e: Evaluation) => void;
  onDeleted?: (id: string) => void;
  onChatDeleted?: (agrNo: string) => void;
  onLogViolation?: () => void;
  onLogTask?: () => void;
  manualAdded?: boolean;
  onRemoveManual?: () => void;
  duplicateAgrs?: string[];
  hideControl?: HideControl;
  addToReviewControl?: AddToReviewControl;
  mailingRows?: Record<string, MailingCell>;
  scoreOverride?: ScoreOverride | null;
  onScoreOverrideSaved?: (o: ScoreOverride) => void;
}) {
  const prevStatuses = prev?.monthly ?? {};
  // Split the stored mailing rows into "value per category" (drives prefill and
  // the reference badges) and "which categories QA saved by hand" (manual rows
  // must win over every automatic source — they are her explicit judgement).
  const detectedStatuses: Record<string, string> = {};
  const manualMailing = new Set<string>();
  for (const [cat, cell] of Object.entries(mailingRows)) {
    detectedStatuses[cat] = cell.status;
    if (cell.source === "manual") manualMailing.add(cat);
  }
  // No saved check for this date yet, but a previous one exists → pre-fill from
  // it so Margarita only edits what changed.
  const prefilledFromPrev = !existing && !!prev;

  // On weekends (Sat/Sun) the duty accountant "Алик" handles reviews.
  const isWeekend = useMemo(() => {
    const d = new Date(date + "T00:00:00Z");
    const dow = d.getUTCDay();
    return dow === 0 || dow === 6;
  }, [date]);
  const weekendDefault = "Алик";
  const [accountant, setAccountant] = useState(
    existing?.accountant ?? (isWeekend ? weekendDefault : chat.accountant ?? "")
  );
  // Ответственный менеджер (п.6) — редактируемый прямо в карточке чата.
  const rowRouter = useRouter();
  const [managerVal, setManagerVal] = useState(chat.manager ?? "");
  const [mgrEditing, setMgrEditing] = useState(false);
  const [mgrSaving, setMgrSaving] = useState(false);
  async function saveManager(next: string) {
    const value = next.trim();
    setMgrSaving(true);
    try {
      const res = await fetch("/api/chats/manager", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agr_no: chat.agr_no, manager: value || null }),
      });
      if (res.ok) {
        setManagerVal(value);
        setMgrEditing(false);
        rowRouter.refresh();
      }
    } finally {
      setMgrSaving(false);
    }
  }
  const [deletingEval, setDeletingEval] = useState(false);
  const [criteria, setCriteria] = useState<CriteriaScores>(() => {
    if (existing?.scores.criteria) return existing.scores.criteria;
    if (prev?.criteria) return prev.criteria;
    // Fall back to AI prediction so the row is pre-filled without clicking «Принять».
    const aiInit = predictEvaluation(accountant || null, prevStatuses, aiModel, {
      status: chat.status,
      debts: chat.debts,
      debtStatus: chat.debt_status,
      date,
    });
    return aiInit.criteria ?? {};
  });
  const [monthly, setMonthly] = useState<Record<string, MonthlyStatus>>(() => {
    const base = emptyMonthly();
    if (existing?.scores.monthly) {
      const merged = { ...base, ...existing.scores.monthly };
      // п.1: если факт рассылки подтверждён сообщением (detected «Получил/
      // Отправил/Нет долга») ПОСЛЕ того, как оценка была сохранена с более
      // слабым статусом, автоматически поднимаем ячейку — не требуя ручной
      // правки. Ручные (manual) строки QA не трогаем: это её явное решение.
      for (const c of MONTHLY_CATEGORIES) {
        const done = MAILING_DONE_STATUS[c.id];
        if (!done || manualMailing.has(c.id)) continue;
        const det = canonicalMonthlyStatus(c, detectedStatuses[c.id] ?? null);
        if (det === done && merged[c.id]?.status !== done) {
          merged[c.id] = { status: done, prev: merged[c.id]?.prev ?? PREV_STATUS_DEFAULT };
        }
      }
      return merged;
    }
    // Auto-fill every status so Margarita only edits exceptions. Order: carried
    // value from the last check → facts (debt feed / client status / deadline
    // date) → the AI model (learned from her labels in Supabase). Every value is
    // canonicalized to a valid option (legacy data can be mis-cased, e.g. «нет
    // долга»), otherwise the <select> would show a blank.
    const aiInit = predictEvaluation(accountant || null, prevStatuses, aiModel, {
      status: chat.status,
      debts: chat.debts,
      debtStatus: chat.debt_status,
      date,
    });
    for (const c of MONTHLY_CATEGORIES) {
      const prevVal = canonicalMonthlyStatus(c, prevStatuses[c.id]);
      // Priority order:
      //   1. A MANUAL row from mqa_chat_mailings — the status QA saved by hand.
      //      It is period-keyed (cycle = 28th → 27th), so a value set once holds
      //      every day of the cycle and resets to «Предстоящая» on the 28th.
      //      It beats everything, including the debt feed — her correction must
      //      never be overwritten by an automatic source (her complaint: «вношу
      //      данные вручную — назавтра они пропадают»).
      //   2. «Долги» from the OneBusiness debts system (overdue + contact log) —
      //      the column she wants filled automatically end-to-end.
      //   3. The auto-detected status from THIS cycle's message scan (it's
      //      cycle-specific evidence, so it beats a carried-over previous value
      //      and the deadline placeholder). The 🔍 badge below the dropdown
      //      shows the same detected value for reference.
      //   4. The value carried from the last check in the same cycle, then the
      //      deadline placeholder, then the AI model.
      const detected = canonicalMonthlyStatus(c, detectedStatuses[c.id] ?? null);
      const manual = manualMailing.has(c.id) ? detected : "";
      const status =
        manual ||
        (c.id === "debts" ? canonicalMonthlyStatus(c, chat.debt_status) : "") ||
        detected ||
        prevVal ||
        autoMonthlyStatus(c, chat.status, chat.debts, date) ||
        canonicalMonthlyStatus(c, aiInit.monthly[c.id]?.status);
      if (status)
        base[c.id] = { status, prev: prevVal || PREV_STATUS_DEFAULT };
    }
    return base;
  });
  const [comment, setComment] = useState(existing?.comment ?? prev?.comment ?? "");
  // Восстанавливаем СОХРАНЁННУЮ итоговую оценку. Сравниваем total_score строки с
  // тем, что дают восстановленные критерии/рассылки по той же формуле, что на
  // сервере (с greeting и жёстким гейтом рассылки). Если расходятся — значит
  // оценка была задана вручную (поле «Общая») ИЛИ критический гейт рассылки с
  // тех пор снялся (рассылку позже авто-подтянули как отправленную). В обоих
  // случаях фиксируем сохранённую оценку в поле override, чтобы «критический»
  // чат НЕ пересчитывался молча в 100 и НЕ перезаписывался при повторном
  // сохранении (баг: «оценила чат как критический — показывает 100»).
  const [override, setOverride] = useState(() => {
    if (!existing || typeof existing.total_score !== "number") return "";
    const recomputed = computeOverall(
      criteria,
      monthly,
      DAILY_CRITERIA,
      existing.scores.greeting
    );
    return Math.abs(recomputed - existing.total_score) > 0.01
      ? String(existing.total_score)
      : "";
  });
  // Manual score override for the SELECTED day (п.8) — open form + fields.
  const [ovOpen, setOvOpen] = useState(false);
  const [ovScore, setOvScore] = useState("");
  const [ovComment, setOvComment] = useState("");
  const [ovSaving, setOvSaving] = useState(false);
  const [ovError, setOvError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(existing?.id ?? null);

  const staleDays = lastActivity ? daysBetween(lastActivity, asOf) : null;
  const isStale = isStaleActivity(lastActivity, asOf);
  // The standing debt amount, brought back to the row (item 5 — "вернуть
  // отображение задолженности, было удобно видеть сумму долга").
  const debt = debtAmountLabel(chat.debts);
  // Brand-new chat (item 6) and "scored, then the client wrote again" (items 9/7).
  const newChat = isNewChat(chat.created_date, asOf);
  // Re-check only when a message landed AFTER the evaluation AND on/after the
  // reviewed day — so back-filling an old date doesn't light up every row.
  const reCheck =
    Boolean(existing) &&
    hasNewMessageAfterEval(chat.last_activity_at, existing?.created_at) &&
    (chat.last_activity_date ?? "") >= date;

  // AI's row: same fields, predicted from the learned model. Re-predicts when
  // the accountant changes (the model is per-accountant).
  const ai = useMemo(
    () =>
      predictEvaluation(accountant || null, prevStatuses, aiModel, {
        status: chat.status,
        debts: chat.debts,
        debtStatus: chat.debt_status,
        date,
      }),
    [accountant, prevStatuses, aiModel, chat.status, chat.debts, chat.debt_status, date]
  );

  const total =
    override.trim() !== "" && !Number.isNaN(Number(override))
      ? Number(override)
      : computeOverall(criteria, monthly, DAILY_CRITERIA);

  // Статус проверки для этой строки: пока не сохранено — «Не проверено»; после
  // сохранения сравниваем текущий финал с прогнозом AI (принято/исправлено).
  const reviewStatus: "not_reviewed" | "accepted" | "corrected" = !savedId
    ? "not_reviewed"
    : reviewStatusFor(
        { criteria: ai.criteria, monthly: ai.monthly, total: ai.total, confidence: ai.confidence },
        { criteria, monthly },
        total
      ) ?? "not_reviewed";
  const reviewBadge =
    reviewStatus === "accepted"
      ? // Сохранено без изменений (решение владельца: слова «Принять/Принято»
        // убрать, оставить «Сохранить»). Совпадение с прогнозом AI → зелёный.
        { text: "✓ Сохранено без изменений", cls: "bg-green-100 text-green-700" }
      : reviewStatus === "corrected"
        ? { text: "✎ Исправлено Маргаритой", cls: "bg-amber-100 text-amber-800" }
        : // Неактивный чат, который ещё не оценивали, — это НЕ «не проверено»
          // (по нему QA не требуется). Показываем «Не был активен», а не «⏳».
          chat.status === "Inactive"
          ? { text: "🚫 Не был активен", cls: "bg-gray-100 text-gray-500" }
          : { text: "⏳ Не активно", cls: "bg-gray-100 text-gray-500" };
  // Честная плашка уверенности: ярлык + тон из confidenceDisplay. Низкая
  // уверенность / неполные данные / предварительная калибровка → предупреждающий
  // стиль (не «всё зелёное»). «Недостаточно данных» вместо подмены на 90%.
  const conf = confidenceDisplay(ai.confidence, {
    preliminary: ai.calibrationPreliminary,
    incompleteData: ai.uncertainty.some((u) => u.includes("не хватает") || u.includes("Не хватает")),
  });
  const CONF_TONE_CLS: Record<ConfidenceTone, string> = {
    low: "bg-red-100 text-red-700",
    medium: "bg-amber-100 text-amber-800",
    high: "bg-blue-100 text-blue-700",
    veryHigh: "bg-emerald-100 text-emerald-700",
    none: "bg-gray-100 text-gray-500",
  };
  const confColor = conf.warn && conf.tone === "veryHigh"
    ? "bg-amber-100 text-amber-800"
    : CONF_TONE_CLS[conf.tone];
  const confTitle = [
    `Уверенность модели: ${conf.text}`,
    conf.label,
    ...ai.uncertainty,
  ].join(" • ");

  const touched =
    Boolean(savedId) ||
    prefilledFromPrev ||
    DAILY_CRITERIA.some((c) => typeof criteria[c.id] === "number") ||
    MONTHLY_CATEGORIES.some((c) => Boolean(monthly[c.id]?.status)) ||
    override.trim() !== "";

  const setCrit = (id: CriterionId, v: string) =>
    setCriteria((c) => ({ ...c, [id]: v === "" ? undefined : Number(v) }));
  const setMon = (id: string, status: string) =>
    setMonthly((m) => ({ ...m, [id]: { ...m[id], status } }));

  // Categories persisted to mqa_chat_mailings during THIS session (drives the
  // 📌 badge immediately, before a server refresh brings the row back).
  const [manualMailingLocal, setManualMailingLocal] = useState<Set<string>>(
    () => new Set()
  );
  const [mailingPersistError, setMailingPersistError] = useState(false);

  /**
   * Persist ONE mailing status to mqa_chat_mailings as a MANUAL row keyed by
   * (chat, cycle, category). Awaitable — throws on failure so the caller can
   * surface it. Called both on every dropdown change (auto-save, see changeMon)
   * and again from save() as a backstop. A status set once holds for the whole
   * рассылки cycle (28th → 27th) on every day's view, survives reloads and
   * auto-detect runs, and resets to «Предстоящая» on the 28th when the period
   * key rolls over. An empty status («—») deletes the manual row, handing the
   * cell back to auto-detection.
   */
  async function persistMailing(category: string, status: string): Promise<void> {
    const res = await fetch("/api/mailings/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agr_no: chat.agr_no,
        period: mailingPeriodOf(date),
        category,
        status,
      }),
    });
    if (!res.ok) throw new Error(String(res.status));
  }

  /**
   * Auto-save a рассылка the instant its dropdown changes, so a status
   * Margarita picks is never lost if she moves to the next chat without pressing
   * «Оценить» (her complaint: «вношу вручную — назавтра пропадают»). A real
   * status is locked as a manual row for the whole cycle; a neutral placeholder
   * («Предстоящая» / «Inactive») or «—» is not a correction, so it DELETES any
   * existing manual lock and hands the cell back to auto-detection. The 📌 badge
   * (manualMailingLocal) updates immediately so she sees it stuck.
   */
  async function autoSaveMailing(category: string, status: string): Promise<void> {
    const lock =
      status !== "" && status !== "Предстоящая" && status !== "Inactive";
    try {
      await persistMailing(category, lock ? status : "");
      setManualMailingLocal((prev) => {
        const next = new Set(prev);
        if (lock) next.add(category);
        else next.delete(category);
        return next;
      });
      setMailingPersistError(false);
    } catch {
      setMailingPersistError(true);
    }
  }

  /** User changed a mailing dropdown / badge: update the row AND persist it
   *  immediately (auto-save), so the рассылка holds for the whole cycle even if
   *  she never presses «Оценить». «Оценить» still re-saves everything as a
   *  backstop. */
  const changeMon = (id: string, status: string) => {
    setMon(id, status);
    void autoSaveMailing(id, status);
  };

  /** One click: agree with the AI — its row becomes Margarita's answer. */
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
      scores: {
        criteria,
        monthly: monthlyWithPrev,
        ai: toSnapshot(ai),
      },
      comment: comment || null,
      total_override: override.trim() !== "" ? Number(override) : null,
      // Уверенность модели в исходном прогнозе — привязана к этой версии AI-оценки.
      ai_confidence: ai.confidence,
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
      // Single save point: «Оценить» writes the WHOLE row at once. The mailing
      // dropdowns no longer save on their own, so here we promote every status
      // she set to a manual row in mqa_chat_mailings (so it holds for the whole
      // рассылки cycle, survives reloads and auto-detect runs). «Предстоящая» /
      // «Inactive» are neutral auto-prefill placeholders, not corrections, so
      // they are never locked. An empty pick on a category that HAD a manual
      // row clears it (hands the cell back to auto-detection). Everything runs
      // together and any failure is surfaced — no more "save twice / next day
      // it disappears".
      const savedManual = new Set<string>();
      let mailingFailed = false;
      await Promise.all(
        MONTHLY_CATEGORIES.map(async (cat) => {
          const status = monthly[cat.id]?.status ?? "";
          if (status === "Предстоящая" || status === "Inactive") return;
          const hadManual =
            manualMailing.has(cat.id) || manualMailingLocal.has(cat.id);
          if (!status && !hadManual) return; // nothing to store, nothing to clear
          try {
            await persistMailing(cat.id, status);
            if (status) savedManual.add(cat.id);
          } catch {
            mailingFailed = true;
          }
        })
      );
      setManualMailingLocal(savedManual);
      setMailingPersistError(mailingFailed);
      // Also update the chat's assigned accountant when it changed — so the
      // change persists across all views, not just this evaluation row.
      const newAcc = accountant || null;
      if (newAcc !== (chat.accountant ?? null)) {
        fetch("/api/chats/accountant", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agr_no: chat.agr_no, accountant: newAcc }),
        }).catch(() => {/* best-effort */});
      }
      // Нарушения создаёт ТОЛЬКО Маргарита вручную (журнал «Нарушения»).
      // Автоматическое создание нарушения из оценки удалено намеренно.
    } catch {
      setError("Сеть");
    } finally {
      setSaving(false);
    }
  }

  async function deleteEval() {
    if (!savedId) return;
    if (!confirm("Удалить эту оценку? Действие необратимо.")) return;
    setDeletingEval(true);
    try {
      const res = await fetch(`/api/evaluations/${savedId}`, { method: "DELETE" });
      if (res.ok) {
        onDeleted?.(savedId);
        setSavedId(null);
      } else {
        setError("Не удалось удалить");
      }
    } catch {
      setError("Сеть");
    } finally {
      setDeletingEval(false);
    }
  }

  // Save a manual score override for the SELECTED day (п.8). Records the old
  // (currently-saved) score, requires a comment, and keeps full history.
  async function saveScoreOverride() {
    const score = Number(ovScore);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      setOvError("Оценка 0..100");
      return;
    }
    if (!ovComment.trim()) {
      setOvError("Комментарий обязателен");
      return;
    }
    setOvSaving(true);
    setOvError(null);
    try {
      const res = await fetch("/api/score-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_agr_no: chat.agr_no,
          score_date: date,
          new_score: score,
          old_score: scoreOverride?.new_score ?? existing?.total_score ?? null,
          client_name: chat.chat_name || null,
          comment: ovComment.trim(),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setOvError(d.error || "Не удалось сохранить");
        return;
      }
      const saved: ScoreOverride = await res.json();
      onScoreOverrideSaved?.(saved);
      setOvOpen(false);
      setOvScore("");
      setOvComment("");
    } catch {
      setOvError("Сетевая ошибка");
    } finally {
      setOvSaving(false);
    }
  }

  // Shared cell classes: a thick top border opens each chat group; the AI row
  // has no bottom border so the two lines read as one chat.
  const aiCell = "ai-cell bg-indigo-50/60 text-gray-600 align-middle";
  const youCell = "align-top";

  return (
    <>
      {/* ---- AI suggestion line ---- */}
      <tr className={`chat-start ${savedId ? "bg-green-100" : ""}`}>
        <td
          rowSpan={2}
          className={`chat-info align-top min-w-[150px] max-w-[210px] ${
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
            {/* п.7: три явных состояния чата. «Неактивный» (источник истины —
                статус из «Основных данных»); «Статус неизвестен / Needs review»
                когда статус не определён — НЕ считаем такой чат активным. */}
            {chat.status === "Inactive" && (
              <span
                className="inline-block rounded bg-gray-700 text-white font-semibold text-xs px-1.5 py-0.5 whitespace-nowrap"
                title="Неактивный чат (по «Основным данным»). Обязательные рассылки по нему не требуются — это НЕ случай «бухгалтер не отправил рассылку»."
              >
                🚫 Неактивный чат
              </span>
            )}
            {chat.status !== "Active" && chat.status !== "Inactive" && (
              <span
                className="inline-block rounded bg-yellow-400 text-yellow-900 font-semibold text-xs px-1.5 py-0.5 whitespace-nowrap"
                title="Статус чата не определён в «Основных данных» — отправлено в Needs review. Не считается активным и не создаёт нарушения по рассылке."
              >
                ❓ Статус неизвестен · Needs review
              </span>
            )}
          </div>
          {/* Full Telegram link, shown in full so QA can read it, select/copy it,
              or paste it into the search box above to jump straight to this chat. */}
          {isTelegramLink(chat.chat_link) && (
            <div className="flex items-center gap-2 mt-0.5 min-w-0">
              <a
                href={tgHref(chat.chat_link!, tgClient)}
                target={tgWindowFor(chat.chat_link!)}
                rel="noreferrer"
                className="text-[11px] font-mono text-blue-600 hover:underline break-all select-all min-w-0"
                title="Открыть чат / выделить и скопировать ссылку"
              >
                {chat.chat_link!.trim()}
              </a>
              <CopyButton
                text={chat.chat_link!.trim()}
                label="⧉"
                className="text-[11px] text-blue-600 hover:underline whitespace-nowrap shrink-0"
                title="Скопировать ссылку"
              />
            </div>
          )}
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
          {/* This row is ONE Telegram chat shared by several contracts —
              list the other contract numbers folded into it. */}
          {duplicateAgrs.length > 0 && (
            <div className="text-xs mt-1">
              <span
                className="inline-block rounded bg-gray-100 text-gray-600 font-medium px-1.5 py-0.5"
                title={`Один Telegram-чат на несколько договоров — оценивается один раз. Договоры: № ${chat.agr_no}, ${duplicateAgrs.join(
                  ", "
                )}`}
              >
                📎 ещё договоры: № {duplicateAgrs.slice(0, 4).join(", ")}
                {duplicateAgrs.length > 4 ? "…" : ""}
              </span>
            </div>
          )}
          {/* Debt amount (item 5) + new-chat / re-check flags (items 6, 9, 7). */}
          {(debt?.owed || newChat || reCheck) && (
            <div className="text-xs mt-1 flex flex-wrap gap-1">
              {debt?.owed && (
                <span
                  className="inline-block rounded bg-red-100 text-red-700 font-semibold px-1.5 py-0.5 whitespace-nowrap"
                  title="Текущая задолженность клиента (из системы долгов OneBusiness)"
                >
                  💰 {debt.text}
                </span>
              )}
              {newChat && (
                <span
                  className="inline-block rounded bg-sky-100 text-sky-700 font-semibold px-1.5 py-0.5 whitespace-nowrap"
                  title={`Новый чат — создан ${chat.created_date ?? ""}`}
                >
                  🆕 новый
                </span>
              )}
              {reCheck && (
                <span
                  className="inline-block rounded bg-purple-100 text-purple-700 font-semibold px-1.5 py-0.5 whitespace-nowrap"
                  title="После вашей оценки в чате появились новые сообщения — перепроверьте (относится к следующему дню проверки)"
                >
                  🔄 новое после оценки
                </span>
              )}
            </div>
          )}
          <div className="mt-1">
            <PersonPicker
              value={accountant}
              options={accountants.map((a) => a.name)}
              placeholder="— бухгалтер —"
              onChange={setAccountant}
            />
          </div>
          {/* Ответственный менеджер по клиенту (п.6) — редактируемый: данных по
              менеджерам нет в основной таблице, поэтому их вносит команда прямо
              здесь. Сохраняется в mqa_chats.manager. */}
          <div className="text-[11px] text-gray-500 mt-1">
            {!mgrEditing ? (
              <span className="inline-flex items-center gap-1">
                Менеджер:{" "}
                <span className={managerVal ? "text-gray-700 font-medium" : "text-gray-400"}>
                  {managerVal || "не указан"}
                </span>
                <button
                  className="text-blue-600 hover:underline"
                  onClick={() => setMgrEditing(true)}
                  title="Назначить / сменить ответственного менеджера"
                >
                  {managerVal ? "изменить" : "указать"}
                </button>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <span className="text-gray-500">Менеджер:</span>
                <input
                  className="input text-[11px] !py-0.5 w-32"
                  list="mgr-people"
                  placeholder="— менеджер —"
                  defaultValue={managerVal}
                  disabled={mgrSaving}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveManager((e.target as HTMLInputElement).value);
                    if (e.key === "Escape") setMgrEditing(false);
                  }}
                  onBlur={(e) => saveManager(e.target.value)}
                />
                <datalist id="mgr-people">
                  {managers.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                {mgrSaving && <span className="text-gray-400">…</span>}
              </span>
            )}
          </div>
          {/* Ручная оценка за выбранный день (п.8): маркер + форма правки. */}
          <div className="mt-1">
            {scoreOverride && (
              <div
                className="text-[11px] rounded bg-amber-100 text-amber-800 px-1.5 py-0.5"
                title={`Изменил: ${scoreOverride.changed_by ?? "—"} · ${scoreOverride.created_at.slice(0, 10)}`}
              >
                ✎ оценка изменена вручную:{" "}
                <b className="tabular-nums">{scoreOverride.new_score}</b>
                {scoreOverride.old_score != null ? ` (было ${scoreOverride.old_score})` : ""}
                {scoreOverride.comment ? ` — «${scoreOverride.comment}»` : ""}
              </div>
            )}
            {!ovOpen ? (
              <button
                className="text-[11px] text-blue-600 hover:underline mt-0.5"
                onClick={() => {
                  setOvScore(String(scoreOverride?.new_score ?? existing?.total_score ?? ""));
                  setOvOpen(true);
                }}
                title="Изменить оценку этого чата за выбранный день (с сохранением истории)"
              >
                {scoreOverride ? "изменить оценку ещё раз" : "изменить оценку за день"}
              </button>
            ) : (
              <div className="mt-1 space-y-1 rounded border border-amber-200 bg-amber-50 p-1.5">
                <div className="flex items-center gap-1">
                  <input
                    className="input w-16 text-xs tabular-nums"
                    inputMode="numeric"
                    placeholder="0-100"
                    value={ovScore}
                    onChange={(e) => setOvScore(e.target.value)}
                  />
                  <span className="text-[11px] text-gray-500">оценка за {date}</span>
                </div>
                <input
                  className="input w-full text-xs"
                  placeholder="комментарий (обязательно)"
                  value={ovComment}
                  onChange={(e) => setOvComment(e.target.value)}
                />
                {ovError && <div className="text-[11px] text-red-600">{ovError}</div>}
                <div className="flex gap-1">
                  <button
                    className="btn-primary text-[11px] px-2 py-0.5"
                    onClick={saveScoreOverride}
                    disabled={ovSaving}
                  >
                    {ovSaving ? "…" : "Сохранить"}
                  </button>
                  <button
                    className="btn-secondary text-[11px] px-2 py-0.5"
                    onClick={() => {
                      setOvOpen(false);
                      setOvError(null);
                    }}
                    disabled={ovSaving}
                  >
                    Отмена
                  </button>
                </div>
              </div>
            )}
          </div>
          {prefilledFromPrev && !savedId && (
            <div
              className="text-[10px] text-gray-400 mt-1"
              title="Значения перенесены из прошлой проверки — измените только то, что изменилось"
            >
              ← перенесено с {prev?.date}
            </div>
          )}
          {manualAdded && (
            <div className="text-xs mt-1 flex items-center gap-1.5">
              <span
                className="inline-block rounded bg-emerald-100 text-emerald-700 font-medium px-1.5 py-0.5"
                title="Чат добавлен в QA вручную за этот день"
              >
                ➕ добавлен вручную
              </span>
              {onRemoveManual && (
                <button
                  onClick={onRemoveManual}
                  className="text-gray-400 hover:text-red-600 hover:underline"
                  title="Убрать чат из списка за этот день"
                >
                  убрать
                </button>
              )}
            </div>
          )}
          {/* 📌 Сохранено — что бот распознал по рассылкам этого чата (п.2):
              найденные категории, дата релевантного/подтверждённого сообщения
              (не «сегодня») и статус подтверждения Маргаритой. Если ничего не
              распознано — нейтральное «Рассылки не обнаружены». */}
          {(() => {
            const found = MONTHLY_CATEGORIES.filter((c) => detectedStatuses[c.id]);
            const dates = found
              .map((c) => mailingRows[c.id]?.at)
              .filter((v): v is string => Boolean(v))
              .map((v) => v.slice(0, 10))
              .sort();
            const relevantDate = dates.length ? dates[dates.length - 1] : null;
            const confirmed = found.some((c) => manualMailing.has(c.id));
            return (
              <div className="text-xs mt-1 rounded bg-gray-50 border border-gray-100 px-2 py-1 space-y-0.5">
                <div className="font-medium text-gray-500">📌 Сохранено</div>
                {found.length === 0 ? (
                  <div className="text-gray-400">Рассылки не обнаружены</div>
                ) : (
                  <>
                    <div className="text-gray-700">
                      Найдено: {found.map((c) => c.shortName).join(", ")}
                    </div>
                    {relevantDate && (
                      <div className="text-gray-500">
                        Дата: {relevantDate.split("-").reverse().join(".")}
                      </div>
                    )}
                    <div className={confirmed ? "text-emerald-700" : "text-sky-700"}>
                      {confirmed ? "Подтверждено Маргаритой" : "Авто-распознавание"}
                    </div>
                  </>
                )}
              </div>
            );
          })()}
          {/* Action buttons: violation / task / hide / add-to-review */}
          <div className="mt-1.5 flex flex-wrap gap-1">
            <button
              onClick={onLogViolation}
              className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 text-xs font-medium px-2 py-1"
              title="Добавить нарушение по этому чату — откроется окно, запись уйдёт в «Нарушения»"
            >
              ⚠️ Нарушение
            </button>
            <button
              onClick={onLogTask}
              className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-medium px-2 py-1"
              title="Добавить задачу по этому чату"
            >
              📋 Задача
            </button>
            {hideControl && (
              <button
                onClick={hideControl.onToggle}
                className={`inline-flex items-center gap-1 rounded border text-xs font-medium px-2 py-1 ${
                  hideControl.hidden
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                    : "border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100"
                }`}
                title={hideControl.hidden ? "Вернуть чат в список за этот день" : "Скрыть чат из списка за этот день"}
              >
                {hideControl.hidden ? "↩ Вернуть" : "🙈 Скрыть"}
              </button>
            )}
            {addToReviewControl && !addToReviewControl.included && (
              <button
                onClick={addToReviewControl.onAdd}
                className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs font-medium px-2 py-1"
                title="Добавить этот чат в список «Активные за день» для выбранной даты"
              >
                ➕ В проверку
              </button>
            )}
            {addToReviewControl?.included && (
              <span className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-100 text-emerald-700 text-xs font-medium px-2 py-1">
                ✓ Добавлен
              </span>
            )}
            {savedId && (
              <button
                onClick={deleteEval}
                disabled={deletingEval}
                className="inline-flex items-center gap-1 rounded border border-red-300 bg-white text-red-500 hover:bg-red-50 text-xs font-medium px-2 py-1"
                title="Удалить оценку за этот день"
              >
                {deletingEval ? "…" : "🗑️"}
              </button>
            )}
          </div>
        </td>
        <td className={`${aiCell} text-center`}>
          <div className="flex flex-col items-center gap-0.5">
            <span
              className="inline-block rounded bg-indigo-100 text-indigo-700 font-semibold text-[11px] px-1.5 py-0.5 whitespace-nowrap"
              title={ai.note}
            >
              🤖 AI
            </span>
            <span
              className={`inline-block rounded ${confColor} font-semibold text-[10px] px-1.5 py-0.5 whitespace-nowrap`}
              title={confTitle}
            >
              {conf.warn && conf.tone !== "none" ? "⚠ " : ""}{conf.text}
            </span>
          </div>
        </td>
        {DAILY_CRITERIA.map((c) => (
          <td key={c.id} className={`${aiCell} text-center tabular-nums`} title={c.name}>
            {ai.criteria[c.id]}
          </td>
        ))}
        {MONTHLY_CATEGORIES.map((c) => {
          const detected = canonicalMonthlyStatus(c, detectedStatuses[c.id] ?? null);
          return (
            <td key={c.id} className={`${aiCell} text-xs text-center`}>
              <div className="flex flex-col items-center gap-0.5">
                <span
                  className="block truncate w-[80px] mx-auto"
                  title={ai.monthly[c.id]?.status}
                >
                  {ai.monthly[c.id]?.status || "—"}
                </span>
                {detected ? (
                  <span
                    className="block h-[15px] w-[80px] truncate rounded px-1 text-[10px] leading-[15px] text-indigo-400"
                    title={`Авто-рассылка: ${detected}`}
                  >
                    🔍 {detected}
                  </span>
                ) : (
                  <span className="block h-[15px]" aria-hidden="true" />
                )}
              </div>
            </td>
          );
        })}
        <td className={`${aiCell} text-center tabular-nums font-semibold`}>{ai.total}</td>
        <td className={`${aiCell} text-center`}>
          <BandChip band={ai.band} />
        </td>
        <td className={`${aiCell} text-xs italic text-gray-500`}>
          <span className="block truncate max-w-[170px]" title={ai.note}>
            {ai.note}
          </span>
        </td>
        {/* Кнопку «Принять» убрали (решение владельца): строка «Вы» уже
            предзаполнена прогнозом AI, поэтому достаточно нажать «Сохранить».
            Если Маргарита ничего не меняет — статус «Сохранено без изменений»
            (зелёный), если правит хотя бы одну ячейку — «Исправлено Маргаритой».
            Так модель учится на её правках. Ячейку оставляем пустой, чтобы не
            ломать выравнивание колонок с шапкой и строкой «Вы». */}
        <td className={`${aiCell} whitespace-nowrap text-right`} aria-hidden="true" />
      </tr>

      {/* ---- Your editable line ---- */}
      <tr className={savedId ? "bg-green-100" : "bg-blue-50/40"}>
        <td className={`${youCell} text-center`}>
          <div className="flex flex-col items-center gap-0.5">
            <span className="inline-block rounded bg-blue-600 text-white font-semibold text-[11px] px-1.5 py-0.5 whitespace-nowrap">
              ✍️ Вы
            </span>
            <span
              className={`inline-block rounded ${reviewBadge.cls} font-medium text-[10px] px-1.5 py-0.5 whitespace-nowrap`}
              title="Итог проверки AI-оценки Маргаритой"
            >
              {reviewBadge.text}
            </span>
          </div>
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
        {MONTHLY_CATEGORIES.map((c) => {
          // Auto-detected рассылка status from THIS month's message scan
          // (mqa_detect_mailings). It pre-fills the dropdown; the badge below
          // shows the same value for reference on EVERY category that has a
          // detection — green ✓ when the cell matches, amber 🔍 to re-apply
          // after a manual change. The select + badge live in a fixed flex
          // column and every mailing cell reserves the badge row, so all four
          // dropdowns are exactly the same height and sit on one line with the
          // info strictly below them.
          const detected = canonicalMonthlyStatus(c, detectedStatuses[c.id] ?? null);
          const current = monthly[c.id]?.status ?? "";
          const matches = Boolean(detected) && detected === current;
          // The cell's current value is a SAVED manual row: either persisted
          // just now (local set), or loaded from the server and still showing
          // that same value. It holds until the 28th (cycle reset).
          const savedManually =
            Boolean(current) &&
            (manualMailingLocal.has(c.id) ||
              (manualMailing.has(c.id) && matches));
          return (
            <td key={c.id} className={`${youCell} text-center`}>
              <div className="flex flex-col items-center gap-0.5">
                <select
                  className="input w-[80px] text-xs"
                  value={monthly[c.id]?.status ?? ""}
                  onChange={(e) => changeMon(c.id, e.target.value)}
                  title={c.name}
                >
                  <option value="">—</option>
                  {c.statuses.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                {savedManually ? (
                  <span
                    className="block h-[15px] w-[80px] truncate rounded px-1 text-[10px] leading-[15px] text-green-700"
                    title="Сохранено вручную — действует каждый день до 28-го числа (сброс цикла рассылок)"
                  >
                    📌 сохранено
                  </span>
                ) : detected ? (
                  <button
                    type="button"
                    onClick={() => changeMon(c.id, detected)}
                    title={
                      matches
                        ? `Авто-распознано из сообщений бухгалтера: «${detected}»`
                        : `Авто-распознано из сообщений: «${detected}». Нажмите, чтобы применить и сохранить до 28-го.`
                    }
                    className={`block h-[15px] w-[80px] truncate rounded px-1 text-[10px] leading-[15px] ${
                      matches
                        ? "text-green-600 cursor-default"
                        : "bg-amber-50 text-amber-700 hover:bg-amber-100"
                    }`}
                  >
                    {matches ? `✓ ${detected}` : `🔍 ${detected}`}
                  </button>
                ) : (
                  <span className="block h-[15px]" aria-hidden="true" />
                )}
              </div>
            </td>
          );
        })}
        <td className={`${youCell} text-center`}>
          <input
            className="input w-[50px] tabular-nums text-center"
            value={override !== "" ? override : touched ? total : ""}
            placeholder="—"
            onChange={(e) => setOverride(e.target.value)}
            title="Авто из критериев; можно переопределить"
          />
        </td>
        <td className={`${youCell} text-center`}>
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
            {saving ? "Сохраняю…" : savedId ? "✓ Сохранено · изменить" : "Сохранить"}
          </button>
          {mailingPersistError && (
            <div
              className="mt-1 text-[10px] text-red-600"
              title="Статус рассылки не записался в базу — проверьте сеть и выберите значение ещё раз"
            >
              ⚠ рассылка не сохранилась
            </div>
          )}
          {error && <span className="ml-1 text-[10px] text-red-600">{error}</span>}
        </td>
      </tr>
    </>
  );
}

/**
 * One editable QA row for the менеджер / юрист roles (item 3 — "в одном чате
 * могут отвечать и бухгалтер, и менеджер; нужно оценивать обоих отдельно").
 * Both are graded on the SAME chat-quality criteria as the accountant — Точность
 * и полнота + Соблюдение сроков / SLA → 0–100 — so a manager who answers in the
 * chat finally lands in QA. Monthly mailings are accountant-specific, so those
 * columns are spanned with a hint instead. The graded person is stored in the
 * evaluation's `accountant` field; the row's `role` keeps it separate.
 */
function RoleQaRow({
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
  const [criteria, setCriteria] = useState<CriteriaScores>(
    existing?.scores.criteria ?? {}
  );
  const [comment, setComment] = useState(existing?.comment ?? "");
  const [override, setOverride] = useState(
    existing && typeof existing.total_score === "number" && !existing.scores.criteria
      ? String(existing.total_score)
      : ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(existing?.id ?? null);

  const info = roleInfo(role);
  // Same chat-quality maths as the accountant, just the two daily criteria.
  const total =
    override.trim() !== "" && !Number.isNaN(Number(override))
      ? Number(override)
      : computeOverall(criteria, undefined, DAILY_CRITERIA);
  const touched =
    Boolean(savedId) ||
    DAILY_CRITERIA.some((c) => typeof criteria[c.id] === "number") ||
    override.trim() !== "";
  // The 4 monthly columns don't apply to a manager/lawyer — span them with a hint.
  const monthlySpan = MONTHLY_CATEGORIES.length;

  const setCrit = (id: CriterionId, v: string) =>
    setCriteria((c) => ({ ...c, [id]: v === "" ? undefined : Number(v) }));

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
            // Default (accounting) scheme: graded on the same criteria → 0–100.
            scores: { criteria },
            comment: comment || null,
            total_override: override.trim() !== "" ? Number(override) : null,
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
      <td className="bg-white align-top min-w-[150px]">
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
      {DAILY_CRITERIA.map((c) => (
        <td key={c.id} className="text-center align-middle">
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
      <td colSpan={monthlySpan} className="align-middle text-xs text-gray-400 italic">
        рассылки — у бухгалтера
      </td>
      <td className="text-center align-middle">
        <input
          className="input w-[50px] tabular-nums text-center"
          value={override !== "" ? override : touched ? total : ""}
          placeholder="—"
          onChange={(e) => setOverride(e.target.value)}
          title="Авто из критериев; можно переопределить"
        />
      </td>
      <td className="align-middle text-center">
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
          {saving ? "Сохраняю…" : savedId ? "✓ Сохранено · изменить" : "Сохранить"}
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
  scope,
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
  onLogViolation,
  onLogTask,
  onDeleted,
  onChatDeleted,
  manualAdded = false,
  onRemoveManual,
  duplicateAgrs = [],
  hideControl = null,
  addToReviewControl = null,
  mailingRows = {},
  scoreOverride = null,
  onScoreOverrideSaved,
}: {
  chat: Chat;
  accountants: Accountant[];
  date: string;
  scope: Scope;
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
  onLogViolation?: () => void;
  onLogTask?: () => void;
  onDeleted?: (id: string) => void;
  onChatDeleted?: (agrNo: string) => void;
  manualAdded?: boolean;
  onRemoveManual?: () => void;
  duplicateAgrs?: string[];
  hideControl?: HideControl;
  addToReviewControl?: AddToReviewControl;
  mailingRows?: Record<string, MailingCell>;
  scoreOverride?: ScoreOverride | null;
  onScoreOverrideSaved?: (o: ScoreOverride) => void;
}) {
  const [showManager, setShowManager] = useState(Boolean(managerEval));
  const [showLawyer, setShowLawyer] = useState(Boolean(lawyerEval));
  const totalCols = DAILY_CRITERIA.length + MONTHLY_CATEGORIES.length + 6;

  return (
    <>
      <ChatScoreRow
        chat={chat}
        accountants={accountants}
        managers={managers}
        date={date}
        scope={scope}
        existing={accountantEval}
        prev={prev}
        lastActivity={lastActivity}
        asOf={asOf}
        aiModel={aiModel}
        tgClient={tgClient}
        onSaved={onSaved}
        onLogViolation={onLogViolation}
        onLogTask={onLogTask}
        onDeleted={onDeleted}
        onChatDeleted={onChatDeleted}
        manualAdded={manualAdded}
        onRemoveManual={onRemoveManual}
        duplicateAgrs={duplicateAgrs}
        hideControl={hideControl}
        addToReviewControl={addToReviewControl}
        mailingRows={mailingRows}
        scoreOverride={scoreOverride}
        onScoreOverrideSaved={onScoreOverrideSaved}
      />
      {showManager && (
        <RoleQaRow
          chat={chat}
          role="manager"
          date={date}
          people={managers}
          existing={managerEval}
          onSaved={onSaved}
        />
      )}
      {showLawyer && (
        <RoleQaRow
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
  const [dropStyle, setDropStyle] = useState<React.CSSProperties>({});
  const btnRef = useRef<HTMLButtonElement>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (
        ref.current && !ref.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function handleToggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const maxH = 288; // max-h-72
      const spaceBelow = window.innerHeight - r.bottom - 8;
      if (spaceBelow >= maxH) {
        setDropStyle({ position: "fixed", top: r.bottom + 4, left: r.left });
      } else {
        setDropStyle({ position: "fixed", top: Math.max(8, r.top - maxH - 4), left: r.left });
      }
    }
    setOpen((o) => !o);
  }

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
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        className="input flex items-center justify-between gap-2 min-w-[160px]"
        onClick={handleToggle}
      >
        <span className="truncate">{label}</span>
        <span className="text-gray-400">▾</span>
      </button>
      {open && (
        <div
          ref={ref}
          style={{ ...dropStyle, width: 256, maxHeight: 288, zIndex: 9999 }}
          className="overflow-auto rounded-lg border border-gray-200 bg-white shadow-xl p-2"
        >
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
