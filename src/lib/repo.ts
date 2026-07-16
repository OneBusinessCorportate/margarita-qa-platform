// Data-access layer. Uses Supabase when configured; otherwise the in-memory
// mock store. Both paths return the same domain types so the UI is agnostic.
import { randomUUID } from "crypto";
import { getServiceClient } from "./supabase/server";
import { store } from "./mock-store";
import { TABLES } from "./tables";
import { isValidEmployee } from "./valid-employees";
import {
  CRITERIA,
  bandFor,
  computeKpiScore,
  computeOverall,
  computeRegistrationScore,
} from "./scoring";
import {
  buildReport,
  perPersonScores,
  precedingWindow,
  reportSnapshotLabel,
  type DailyReport,
  type ReportFilters,
  type ReportSnapshot,
} from "./report";
import { telegramChatId } from "./chat-list";
import { buildViolationWorkflowReport } from "./appeals-report";
import type { DebtTotals } from "./debts";
import { debtsCellValue } from "./debts";
import type {
  Accountant,
  ActiveExclusion,
  ActiveInclusion,
  AppealStatus,
  Chat,
  ChatMailing,
  Evaluation,
  NewEvaluationInput,
  NewScoreOverrideInput,
  NewTaskInput,
  NewViolationAppealInput,
  NewViolationInput,
  ScoreOverride,
  Task,
  TaskPatch,
  Violation,
  ViolationAppeal,
  ViolationStatus,
} from "./types";
import {
  WorkflowError,
  appealStatusFor,
  assertCanAppeal,
  assertCanResolve,
  canAcknowledge,
  violationStatusForDecision,
} from "./violation-workflow";

function overallFor(input: NewEvaluationInput): number {
  if (typeof input.total_override === "number") return input.total_override;
  // Each scheme computes its 0..100 total differently; default is accounting.
  switch (input.scores.scheme) {
    case "registration":
      return computeRegistrationScore(input.scores.registration ?? {});
    case "accounting_kpi":
      return computeKpiScore(input.scores.kpi ?? {});
    default:
      return computeOverall(
        input.scores.criteria ?? {},
        input.scores.monthly,
        CRITERIA,
        input.scores.greeting
      );
  }
}

// PostgREST returns `numeric`/`double precision` columns in ways that can
// surface as strings depending on driver/type. Normalize so downstream math
// (report aggregation) always operates on real numbers.
function normalizeEvaluation(row: any): Evaluation {
  return {
    ...row,
    role: row.role ?? "accountant",
    total_score: Number(row.total_score),
  } as Evaluation;
}

// --- Chats -----------------------------------------------------------------

export async function listChats(search?: string): Promise<Chat[]> {
  const sb = getServiceClient();
  if (sb) {
    let q = sb.from(TABLES.chats).select("*").order("agr_no").limit(10000);
    const { data, error } = await q;
    if (error) throw error;
    let rows = (data ?? []) as Chat[];
    if (search) rows = filterChats(rows, search);
    return rows;
  }
  let rows = store().chats;
  if (search) rows = filterChats(rows, search);
  return rows;
}

function filterChats(rows: Chat[], search: string): Chat[] {
  const n = search.toLowerCase();
  return rows.filter(
    (c) =>
      c.agr_no.toLowerCase().includes(n) ||
      c.chat_name.toLowerCase().includes(n) ||
      (c.name_agr ?? "").toLowerCase().includes(n)
  );
}

/**
 * Per-day chat activity (one row per chat per day it was active), so the scoring
 * day view can show EVERY chat active on a day — not just chats whose most recent
 * activity was that day. Sourced from mqa_chat_activity (messages + feed). `from`
 * bounds the window so the payload stays small. Falls back to each chat's single
 * last_activity_date in the in-memory store (dev/seed) where the table is absent.
 */
export async function listChatActivity(
  from?: string
): Promise<{ chat_agr_no: string; date: string; at: string | null }[]> {
  const sb = getServiceClient();
  if (sb) {
    let q = sb
      .from(TABLES.chatActivity)
      .select("agr_no, active_date, last_at")
      .order("active_date", { ascending: false })
      .limit(20000);
    if (from) q = q.gte("active_date", from);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((r) => ({
      chat_agr_no: r.agr_no as string,
      date: String(r.active_date).slice(0, 10),
      at: (r.last_at as string | null) ?? null,
    }));
  }
  return store()
    .chats.filter((c) => c.last_activity_date)
    .map((c) => ({
      chat_agr_no: c.agr_no,
      date: c.last_activity_date!.slice(0, 10),
      at: c.last_activity_at ?? c.last_activity_date ?? null,
    }));
}

/**
 * Load all detected/confirmed mailing rows for a given period (YYYYMM).
 * Returns an empty array when Supabase is not configured (local dev / mock store).
 */
export async function listChatMailings(period: string): Promise<ChatMailing[]> {
  const sb = getServiceClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from(TABLES.chatMailings)
    .select("*")
    .eq("period", period);
  // Non-critical scoring-form overlay (see listActiveInclusions): if the table
  // is missing (migration not yet applied) or the read fails, degrade to "no
  // detected mailings" rather than crashing the whole scoring page.
  if (error) {
    console.warn(`listChatMailings: ${error.message}`);
    return [];
  }
  return (data ?? []) as ChatMailing[];
}

/**
 * Tally UNIQUE client chats per accountant from raw client messages. The unit is
 * a CHAT, not a message: five client messages in one chat count as ONE request
 * for that chat's accountant (fixes the impossible «Запрос — 60» totals that
 * counted every message / duplicate sync record). Pure + unit-tested.
 */
export function tallyRequestChats(
  rows: { chat_id: string | number }[],
  chatIdToAcc: Map<string, string>
): { accountant: string; count: number }[] {
  const chatsByAcc = new Map<string, Set<string>>();
  for (const m of rows) {
    const cid = String(m.chat_id);
    const acc = chatIdToAcc.get(cid);
    if (!acc) continue;
    if (!chatsByAcc.has(acc)) chatsByAcc.set(acc, new Set());
    chatsByAcc.get(acc)!.add(cid);
  }
  return [...chatsByAcc.entries()]
    .map(([accountant, set]) => ({ accountant, count: set.size }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Count UNIQUE client chats ("запросы") per accountant over an inclusive ISO date
 * window, Yerevan days. The unit is the chat, not the message — so the figure can
 * never exceed the accountant's chat count. Feeds the «Кол-во запросов за день»
 * section. Empty on mock store / read errors (the section is then omitted).
 */
export async function countClientRequests(
  from: string,
  to: string
): Promise<{ accountant: string; count: number }[]> {
  const sb = getServiceClient();
  if (!sb) return [];

  const { data: chats, error: chatsErr } = await sb
    .from(TABLES.chats)
    .select("agr_no, chat_link, accountant")
    .not("chat_link", "is", null);
  if (chatsErr) {
    console.warn(`countClientRequests: ${chatsErr.message}`);
    return [];
  }
  const chatIdToAcc = new Map<string, string>();
  for (const c of chats ?? []) {
    const cid = telegramChatId(c.chat_link as string | null);
    if (cid && c.accountant) chatIdToAcc.set(cid, c.accountant as string);
  }
  if (chatIdToAcc.size === 0) return [];

  // Armenia is UTC+4 (no DST): Yerevan midnight = UTC date minus 4 h.
  const offsetMs = 4 * 60 * 60 * 1000;
  const start = new Date(new Date(from + "T00:00:00Z").getTime() - offsetMs).toISOString();
  const endExclusive = new Date(
    new Date(to + "T00:00:00Z").getTime() + 24 * 60 * 60 * 1000 - offsetMs
  ).toISOString();

  const rows: { chat_id: string | number }[] = [];
  const PAGE = 1000;
  for (let fromRow = 0; ; fromRow += PAGE) {
    const { data, error } = await sb
      .from("messages")
      .select("chat_id")
      .eq("sender_role", "client")
      .gte("created_at", start)
      .lt("created_at", endExclusive)
      .range(fromRow, fromRow + PAGE - 1);
    if (error) {
      console.warn(`countClientRequests: ${error.message}`);
      return [];
    }
    rows.push(...((data ?? []) as { chat_id: string | number }[]));
    if ((data ?? []).length < PAGE) break;
  }
  // Unique chats per accountant — NOT message counts (see tallyRequestChats).
  return tallyRequestChats(rows, chatIdToAcc);
}

export async function getChat(agrNo: string): Promise<Chat | null> {
  const sb = getServiceClient();
  if (sb) {
    const { data, error } = await sb
      .from(TABLES.chats)
      .select("*")
      .eq("agr_no", agrNo)
      .maybeSingle();
    if (error) throw error;
    return (data as Chat) ?? null;
  }
  return store().chats.find((c) => c.agr_no === agrNo) ?? null;
}

/**
 * Find — or create — a chat from a pasted Telegram link, so Margarita can pull a
 * conversation into QA even when it never made it into mqa_chats (item 6: "не
 * все чаты есть в платформе"; item 5: previous-day chats to flag). Idempotent:
 * a link already present (matched by its Telegram chat id, across A/K/t.me) is
 * returned as-is; otherwise a minimal chat row is inserted with a stable
 * `TG…`-prefixed agr_no derived from the link id, so re-adding the same link
 * never duplicates.
 */
export async function createChatFromLink(
  link: string,
  name?: string | null
): Promise<Chat> {
  const id = telegramChatId(link);
  const agr_no = id ? `TG${id}` : `TG-${randomUUID().slice(0, 8)}`;

  // Already in the system under this generated key → reuse it.
  const byKey = await getChat(agr_no);
  if (byKey) return byKey;
  // Or already present under a different agr_no but the SAME Telegram chat id.
  if (id) {
    const all = await listChats();
    const match = all.find((c) => telegramChatId(c.chat_link) === id);
    if (match) return match;
  }

  // Minimal valid row (chat_name is NOT NULL; accountant left null so it doesn't
  // hit the FK to mqa_accountants). debt_status is omitted — the debts sync fills
  // it later. created_date marks it as a fresh, manually-added chat.
  const row: Chat = {
    agr_no,
    hvhh: null,
    name_agr: null,
    name_tax: null,
    status: "Active",
    tax_activation_date: null,
    chat_name: (name && name.trim()) || "Чат из Telegram (ручной)",
    chat_link: link,
    accountant: null,
    manager: null,
    debts: null,
    created_date: new Date().toISOString().slice(0, 10),
    last_activity_date: null,
    last_activity_at: null,
    last_sender_role: null,
    unanswered: null,
  };

  const sb = getServiceClient();
  if (sb) {
    const { data, error } = await sb
      .from(TABLES.chats)
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    return data as Chat;
  }
  store().chats.push(row);
  return row;
}

// --- Accountants -----------------------------------------------------------

/**
 * Оставляем только действующих сотрудников: для роли «accountant» — строго 14
 * человек из утверждённого списка (valid-employees), иначе отсекаем уволенных,
 * чужие отделы и опечатки (Գայանե Դ․, Էմիլյա, Սոնա, Տաթև, Սաթենիկ …), которые
 * по-прежнему помечены active в общей БД. Не-бухгалтерские роли (юрист,
 * регистрация, менеджер) не трогаем — их в списке 14 и не должно быть.
 */
function keepValidAccountant(a: Accountant): boolean {
  if ((a.role ?? "accountant") !== "accountant") return true;
  return isValidEmployee(a.name);
}

export async function listAccountants(): Promise<Accountant[]> {
  const sb = getServiceClient();
  if (sb) {
    const { data, error } = await sb
      .from(TABLES.accountants)
      .select("*")
      .eq("active", true)
      .neq("role", "dismissed")
      .order("name");
    if (error) throw error;
    return ((data ?? []) as Accountant[]).filter(keepValidAccountant);
  }
  return store()
    .accountants.filter((a) => a.active && a.role !== "dismissed")
    .filter(keepValidAccountant);
}

// --- Evaluations -----------------------------------------------------------

export async function listEvaluations(
  filters: ReportFilters = {}
): Promise<Evaluation[]> {
  const sb = getServiceClient();
  let rows: Evaluation[];
  if (sb) {
    // Push filters into the query so large histories aren't truncated by the
    // default 1000-row cap (reports must see every row in range).
    let q = sb.from(TABLES.evaluations).select("*");
    if (filters.from) q = q.gte("checking_date", filters.from);
    if (filters.to) q = q.lte("checking_date", filters.to);
    if (filters.accountant) q = q.eq("accountant", filters.accountant);
    if (filters.client) q = q.ilike("chat_agr_no", `%${filters.client}%`);
    const { data, error } = await q
      .order("created_at", { ascending: false })
      .limit(10000);
    if (error) throw error;
    rows = (data ?? []).map(normalizeEvaluation);
  } else {
    rows = [...store().evaluations].sort((a, b) =>
      b.created_at.localeCompare(a.created_at)
    );
  }
  return applyEvalFilters(rows, filters);
}

function applyEvalFilters(rows: Evaluation[], f: ReportFilters): Evaluation[] {
  return rows.filter((e) => {
    const d = e.checking_date.slice(0, 10);
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;
    if (f.accountant && e.accountant !== f.accountant) return false;
    if (f.client) {
      const n = f.client.toLowerCase();
      if (!e.chat_agr_no.toLowerCase().includes(n)) return false;
    }
    return true;
  });
}

/** Compute total + band from scores using the active model, then persist. */
export async function createEvaluation(
  input: NewEvaluationInput
): Promise<Evaluation> {
  const total = overallFor(input);

  const row: Evaluation = {
    id: randomUUID(),
    chat_agr_no: input.chat_agr_no,
    period: input.period,
    checking_date: input.checking_date,
    role: input.role ?? "accountant",
    accountant: input.accountant,
    scores: input.scores,
    total_score: total,
    quality_band: bandFor(total),
    comment: input.comment,
    created_at: new Date().toISOString(),
  };

  const sb = getServiceClient();
  if (sb) {
    // Upsert on (chat_agr_no, checking_date, role): one row per role per day.
    // This makes re-scoring a chat that the page hadn't loaded (it only loads
    // the most recent 1000 evaluations) update the existing row instead of
    // hitting the unique constraint. id/created_at are omitted so the existing
    // row keeps them on conflict, and the DB defaults fill them on insert.
    const payload: Record<string, unknown> = { ...row };
    delete payload.id;
    delete payload.created_at;
    const { data, error } = await sb
      .from(TABLES.evaluations)
      .upsert(payload, { onConflict: "chat_agr_no,checking_date,role" })
      .select()
      .single();
    if (error) throw error;
    return normalizeEvaluation(data);
  }
  // Mock store: replace any existing row for the same (chat, date, role).
  const s = store();
  s.evaluations = s.evaluations.filter(
    (e) =>
      !(
        e.chat_agr_no === row.chat_agr_no &&
        e.checking_date === row.checking_date &&
        (e.role ?? "accountant") === row.role
      )
  );
  s.evaluations.unshift(row);
  return row;
}

export async function updateEvaluation(
  id: string,
  input: NewEvaluationInput
): Promise<Evaluation> {
  const total = overallFor(input);
  const patch = {
    chat_agr_no: input.chat_agr_no,
    period: input.period,
    checking_date: input.checking_date,
    role: input.role ?? "accountant",
    accountant: input.accountant,
    scores: input.scores,
    total_score: total,
    quality_band: bandFor(total),
    comment: input.comment,
  };

  const sb = getServiceClient();
  if (sb) {
    const { data, error } = await sb
      .from(TABLES.evaluations)
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return normalizeEvaluation(data);
  }
  const rows = store().evaluations;
  const idx = rows.findIndex((e) => e.id === id);
  if (idx === -1) throw new Error(`Evaluation ${id} not found`);
  rows[idx] = { ...rows[idx], ...patch };
  return rows[idx];
}

export async function deleteEvaluation(id: string): Promise<void> {
  const sb = getServiceClient();
  if (sb) {
    const { error } = await sb.from(TABLES.evaluations).delete().eq("id", id);
    if (error) throw error;
    return;
  }
  const rows = store().evaluations;
  const idx = rows.findIndex((e) => e.id === id);
  if (idx !== -1) rows.splice(idx, 1);
}

/** Permanently delete a chat and all its evaluations from mqa_chats (cascades). */
export async function deleteChat(agrNo: string): Promise<void> {
  const sb = getServiceClient();
  if (sb) {
    const { error } = await sb.from(TABLES.chats).delete().eq("agr_no", agrNo);
    if (error) throw error;
    return;
  }
  const s = store();
  const idx = s.chats.findIndex((c) => c.agr_no === agrNo);
  if (idx !== -1) s.chats.splice(idx, 1);
  // Remove associated evaluations from mock store too.
  const evals = s.evaluations.filter((e) => e.chat_agr_no !== agrNo);
  s.evaluations.length = 0;
  s.evaluations.push(...evals);
}

/**
 * Update the chat's assigned accountant in mqa_chats. A manual reassignment
 * PINS the accountant (accountant_pinned = true) so the daily «Основные данные»
 * sync won't silently revert it (п.1 — «чаты новых бухгалтеров откатываются»).
 */
export async function updateChatAccountant(
  agrNo: string,
  accountant: string | null
): Promise<void> {
  const sb = getServiceClient();
  if (sb) {
    const { error } = await sb
      .from(TABLES.chats)
      .update({ accountant, accountant_pinned: true })
      .eq("agr_no", agrNo);
    if (error) throw error;
    return;
  }
  const chat = store().chats.find((c) => c.agr_no === agrNo);
  if (chat) {
    chat.accountant = accountant;
    chat.accountant_pinned = true;
  }
}

/** Update the chat's responsible manager in mqa_chats (п.6). */
export async function updateChatManager(
  agrNo: string,
  manager: string | null
): Promise<void> {
  const value = manager && manager.trim() ? manager.trim() : null;
  const sb = getServiceClient();
  if (sb) {
    const { error } = await sb
      .from(TABLES.chats)
      .update({ manager: value })
      .eq("agr_no", agrNo);
    if (error) throw error;
    return;
  }
  const chat = store().chats.find((c) => c.agr_no === agrNo);
  if (chat) chat.manager = value;
}

/**
 * Create — or reuse — a chat by its contract № (п.3). Lets Маргарита add ANY
 * chat that's missing from the platform (present in «КК Сопровождения» /
 * «Налоговый кабинет» but not «Основные данные») straight from the add-box,
 * without a Telegram link. Idempotent on agr_no.
 */
export async function createChatByNumber(
  agrNo: string,
  chatName?: string | null,
  link?: string | null
): Promise<Chat> {
  const agr = agrNo.trim();
  if (!agr) throw new Error("Укажите № договора");
  const existing = await getChat(agr);
  if (existing) return existing;

  const row: Chat = {
    agr_no: agr,
    hvhh: null,
    name_agr: null,
    name_tax: null,
    status: "Active",
    tax_activation_date: null,
    chat_name: (chatName && chatName.trim()) || agr,
    chat_link: (link && link.trim()) || null,
    accountant: null,
    manager: null,
    debts: null,
    created_date: new Date().toISOString().slice(0, 10),
    last_activity_date: null,
    last_activity_at: null,
    last_sender_role: null,
    unanswered: null,
  };

  const sb = getServiceClient();
  if (sb) {
    const { data, error } = await sb
      .from(TABLES.chats)
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    return data as Chat;
  }
  store().chats.push(row);
  return row;
}

// --- Tasks -----------------------------------------------------------------

export async function listTasks(chatAgrNo?: string): Promise<Task[]> {
  const sb = getServiceClient();
  if (sb) {
    // A stable order + explicit high limit like every other list here: without
    // them PostgREST caps at its default (~1000 rows) AND returns an arbitrary
    // slice (no ORDER BY), so once tasks grow past the cap the dashboard's task
    // metrics would fluctuate between refreshes. Order deterministically and
    // lift the cap so reports always see every task in range.
    let q = sb
      .from(TABLES.tasks)
      .select("*")
      .order("checking_date", { ascending: false })
      .limit(20000);
    if (chatAgrNo) q = q.eq("chat_agr_no", chatAgrNo);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as Task[];
  }
  const rows = store().tasks;
  return chatAgrNo ? rows.filter((t) => t.chat_agr_no === chatAgrNo) : rows;
}

export async function createTask(input: NewTaskInput): Promise<Task> {
  const checking_date =
    input.checking_date ?? new Date().toISOString().slice(0, 10);
  const row: Task = {
    id: randomUUID(),
    chat_agr_no: input.chat_agr_no,
    type: input.type ?? "single",
    category: input.category ?? null,
    status: null,
    prev_status: null,
    due_date_original: input.due_date_original ?? null,
    due_date_postponed: input.due_date_postponed ?? null,
    completed_at: input.completed_at ?? null,
    priority: input.priority ?? "Medium",
    description: input.description ?? null,
    result: input.result ?? null,
    task_status: input.task_status ?? "-",
    accountant: input.accountant ?? null,
    checking_date,
    period: checking_date.slice(0, 7).replace("-", ""),
    recurring: input.recurring ?? false,
    qa_confirmed: false,
    qa_confirmed_at: null,
    qa_confirmed_by: null,
  };
  const sb = getServiceClient();
  if (sb) {
    const { data, error } = await sb
      .from(TABLES.tasks)
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    return data as Task;
  }
  store().tasks.unshift(row);
  return row;
}

/** Update an existing task's status / QA confirmation (item 8, boss's note). */
export async function updateTask(id: string, patch: TaskPatch): Promise<Task> {
  const fields: Record<string, unknown> = {};
  if (patch.task_status !== undefined) fields.task_status = patch.task_status;
  if (patch.due_date_original !== undefined)
    fields.due_date_original = patch.due_date_original || null;
  if (patch.due_date_postponed !== undefined)
    fields.due_date_postponed = patch.due_date_postponed || null;
  if (patch.completed_at !== undefined) fields.completed_at = patch.completed_at;
  if (patch.result !== undefined) fields.result = patch.result;
  if (patch.recurring !== undefined) fields.recurring = patch.recurring;
  if (patch.qa_confirmed !== undefined) {
    fields.qa_confirmed = patch.qa_confirmed;
    fields.qa_confirmed_at = patch.qa_confirmed ? new Date().toISOString() : null;
    fields.qa_confirmed_by = patch.qa_confirmed ? patch.qa_confirmed_by ?? null : null;
  }
  const sb = getServiceClient();
  if (sb) {
    const { data, error } = await sb
      .from(TABLES.tasks)
      .update(fields)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data as Task;
  }
  const rows = store().tasks;
  const idx = rows.findIndex((t) => t.id === id);
  if (idx === -1) throw new Error(`Task ${id} not found`);
  rows[idx] = { ...rows[idx], ...(fields as Partial<Task>) };
  return rows[idx];
}

// --- Active-list exclusions ("Скрыть из активных за день") ------------------

/** Chats QA manually hid from the "Активные за день" list, per (chat, day). */
export async function listActiveExclusions(): Promise<ActiveExclusion[]> {
  const sb = getServiceClient();
  if (sb) {
    const { data, error } = await sb
      .from(TABLES.activeExclusions)
      .select("agr_no, exclude_date");
    // Non-critical per-day overlay (see listActiveInclusions): degrade to "no
    // manual exclusions" instead of crashing the scoring page.
    if (error) {
      console.warn(`listActiveExclusions: ${error.message}`);
      return [];
    }
    return (data ?? []).map((r: any) => ({
      chat_agr_no: r.agr_no,
      exclude_date: String(r.exclude_date).slice(0, 10),
    }));
  }
  return store().activeExclusions;
}

export async function addActiveExclusion(
  chatAgrNo: string,
  excludeDate: string
): Promise<void> {
  const sb = getServiceClient();
  if (sb) {
    const { error } = await sb
      .from(TABLES.activeExclusions)
      .upsert(
        { agr_no: chatAgrNo, exclude_date: excludeDate },
        { onConflict: "agr_no,exclude_date" }
      );
    if (error) throw error;
    return;
  }
  const rows = store().activeExclusions;
  if (
    !rows.some(
      (r) => r.chat_agr_no === chatAgrNo && r.exclude_date === excludeDate
    )
  )
    rows.push({ chat_agr_no: chatAgrNo, exclude_date: excludeDate });
}

export async function removeActiveExclusion(
  chatAgrNo: string,
  excludeDate: string
): Promise<void> {
  const sb = getServiceClient();
  if (sb) {
    const { error } = await sb
      .from(TABLES.activeExclusions)
      .delete()
      .eq("agr_no", chatAgrNo)
      .eq("exclude_date", excludeDate);
    if (error) throw error;
    return;
  }
  const s = store();
  s.activeExclusions = s.activeExclusions.filter(
    (r) => !(r.chat_agr_no === chatAgrNo && r.exclude_date === excludeDate)
  );
}

// --- Active-list inclusions ("Добавить чат в QA вручную") -------------------

/** Chats Margarita manually pulled into "Активные за день", per (chat, day). */
export async function listActiveInclusions(): Promise<ActiveInclusion[]> {
  const sb = getServiceClient();
  if (sb) {
    const { data, error } = await sb
      .from(TABLES.activeInclusions)
      .select("agr_no, include_date");
    // Non-critical per-day overlay: if the table is missing (migration not yet
    // applied) or the read fails, degrade to "no manual inclusions" rather than
    // taking down the whole scoring page.
    if (error) {
      console.warn(`listActiveInclusions: ${error.message}`);
      return [];
    }
    return (data ?? []).map((r: any) => ({
      chat_agr_no: r.agr_no,
      include_date: String(r.include_date).slice(0, 10),
    }));
  }
  return store().activeInclusions;
}

export async function addActiveInclusion(
  chatAgrNo: string,
  includeDate: string
): Promise<void> {
  const sb = getServiceClient();
  if (sb) {
    const { error } = await sb
      .from(TABLES.activeInclusions)
      .upsert(
        { agr_no: chatAgrNo, include_date: includeDate },
        { onConflict: "agr_no,include_date" }
      );
    if (error) throw error;
    return;
  }
  const rows = store().activeInclusions;
  if (
    !rows.some(
      (r) => r.chat_agr_no === chatAgrNo && r.include_date === includeDate
    )
  )
    rows.push({ chat_agr_no: chatAgrNo, include_date: includeDate });
}

export async function removeActiveInclusion(
  chatAgrNo: string,
  includeDate: string
): Promise<void> {
  const sb = getServiceClient();
  if (sb) {
    const { error } = await sb
      .from(TABLES.activeInclusions)
      .delete()
      .eq("agr_no", chatAgrNo)
      .eq("include_date", includeDate);
    if (error) throw error;
    return;
  }
  const s = store();
  s.activeInclusions = s.activeInclusions.filter(
    (r) => !(r.chat_agr_no === chatAgrNo && r.include_date === includeDate)
  );
}

// --- Violations (Нарушения) ------------------------------------------------

export async function listViolations(filters: {
  from?: string;
  to?: string;
  accountant?: string;
} = {}): Promise<Violation[]> {
  const sb = getServiceClient();
  if (sb) {
    let q = sb.from(TABLES.violations).select("*");
    if (filters.from) q = q.gte("vdate", filters.from);
    if (filters.to) q = q.lte("vdate", filters.to);
    if (filters.accountant) q = q.eq("accountant", filters.accountant);
    const { data, error } = await q.order("vdate", { ascending: false }).limit(5000);
    if (error) throw error;
    return (data ?? []).map((v: any) => ({
      ...v,
      sanction: v.sanction === null ? null : Number(v.sanction),
    })) as Violation[];
  }
  let rows = [...store().violations].sort((a, b) => b.vdate.localeCompare(a.vdate));
  if (filters.from) rows = rows.filter((v) => v.vdate >= filters.from!);
  if (filters.to) rows = rows.filter((v) => v.vdate <= filters.to!);
  if (filters.accountant) rows = rows.filter((v) => v.accountant === filters.accountant);
  return rows;
}

export async function createViolation(
  input: NewViolationInput
): Promise<Violation> {
  const status: ViolationStatus = input.status ?? "new";
  const row: Violation = {
    id: randomUUID(),
    vdate: input.vdate,
    accountant: input.accountant ?? null,
    chat_agr_no: input.chat_agr_no ?? null,
    client: input.client ?? null,
    severity: input.severity ?? null,
    violation_type: input.violation_type ?? null,
    gross: input.gross ?? null,
    sanction: input.sanction ?? null,
    note: input.note ?? null,
    // Margarita's manual entries are confirmed by her by default. Auto-imported
    // rows pass confirmed:false so they never masquerade as confirmed penalties.
    confirmed: input.confirmed ?? true,
    status,
    acknowledged_at: null,
    acknowledged_by: null,
    // Keep the legacy appeal_status mirror in sync with the workflow status.
    appeal_status: input.appeal_status ?? appealStatusFor(status),
    created_at: new Date().toISOString(),
  };
  const sb = getServiceClient();
  if (sb) {
    const { data, error } = await sb
      .from(TABLES.violations)
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    return data as Violation;
  }
  store().violations.unshift(row);
  return row;
}

/** Fetch one violation by id (both backends). Null when absent. */
export async function getViolation(id: string): Promise<Violation | null> {
  const sb = getServiceClient();
  if (sb) {
    const { data, error } = await sb
      .from(TABLES.violations)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { ...data, sanction: data.sanction == null ? null : Number(data.sanction) } as Violation;
  }
  return store().violations.find((v) => v.id === id) ?? null;
}

// --- Violation workflow: acknowledgement + appeals -------------------------

/**
 * Accountant «Ознакомлен»: mark a violation acknowledged. Idempotent — a
 * violation that is already acknowledged / appealed / resolved is returned
 * unchanged (repeated requests never create duplicates or overwrite an appeal).
 * On Supabase the update is guarded by `status = 'new'`, so two concurrent
 * acknowledgements can never both win.
 */
export async function acknowledgeViolation(
  id: string,
  by?: string | null
): Promise<Violation> {
  const existing = await getViolation(id);
  if (!existing) throw new WorkflowError("Нарушение не найдено", 404);
  if (!canAcknowledge(existing)) return existing; // idempotent no-op

  const now = new Date().toISOString();
  const patch = { status: "acknowledged" as const, acknowledged_at: now, acknowledged_by: by ?? existing.accountant ?? null };

  const sb = getServiceClient();
  if (sb) {
    const { data, error } = await sb
      .from(TABLES.violations)
      .update(patch)
      .eq("id", id)
      .eq("status", "new") // concurrency guard
      .select()
      .maybeSingle();
    if (error) throw error;
    // Lost the race (someone acknowledged/appealed first) → return current row.
    return (data as Violation) ?? (await getViolation(id))!;
  }
  const v = store().violations.find((x) => x.id === id)!;
  Object.assign(v, patch);
  return v;
}

/** Appeals for a violation (newest first). Both backends. */
export async function listViolationAppealsFor(
  violationId: string
): Promise<ViolationAppeal[]> {
  const sb = getServiceClient();
  if (sb) {
    const { data, error } = await sb
      .from(TABLES.violationAppeals)
      .select("*")
      .eq("violation_id", violationId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as ViolationAppeal[];
  }
  return store()
    .violationAppeals.filter((a) => a.violation_id === violationId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** All violation-appeals (newest first), optionally filtered. Both backends. */
export async function listViolationAppeals(filters: {
  status?: string;
  accountant?: string;
} = {}): Promise<ViolationAppeal[]> {
  const sb = getServiceClient();
  let rows: ViolationAppeal[];
  if (sb) {
    let q = sb.from(TABLES.violationAppeals).select("*");
    if (filters.status) q = q.eq("status", filters.status);
    if (filters.accountant) q = q.eq("accountant", filters.accountant);
    const { data, error } = await q
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) throw error;
    rows = (data ?? []) as ViolationAppeal[];
  } else {
    rows = [...store().violationAppeals].sort((a, b) =>
      b.created_at.localeCompare(a.created_at)
    );
    if (filters.status) rows = rows.filter((a) => a.status === filters.status);
    if (filters.accountant) rows = rows.filter((a) => a.accountant === filters.accountant);
  }
  return rows;
}

/** A violation-appeal joined with its disputed violation, for the /appeals UI. */
export interface ViolationAppealView extends ViolationAppeal {
  violation: Violation | null;
}

/**
 * All violation-appeals (filtered) enriched with their disputed violation, so
 * the /appeals page can show every field (date, client/chat, category,
 * description, Margarita's comment, penalty, status, decision). Both backends.
 */
export async function listViolationAppealViews(filters: {
  status?: string;
  accountant?: string;
} = {}): Promise<ViolationAppealView[]> {
  const appeals = await listViolationAppeals(filters);
  const ids = [...new Set(appeals.map((a) => a.violation_id))];
  const byId = new Map<string, Violation>();
  const sb = getServiceClient();
  if (sb && ids.length) {
    const { data, error } = await sb
      .from(TABLES.violations)
      .select("*")
      .in("id", ids);
    if (error) throw error;
    for (const v of (data ?? []) as any[]) {
      byId.set(v.id, { ...v, sanction: v.sanction == null ? null : Number(v.sanction) } as Violation);
    }
  } else if (!sb) {
    for (const v of store().violations) if (ids.includes(v.id)) byId.set(v.id, v);
  }
  return appeals.map((a) => ({ ...a, violation: byId.get(a.violation_id) ?? null }));
}

/**
 * Accountant «Подать апелляцию»: file an appeal against a violation. Validates
 * on the server (never trusts the client): text is required, the violation must
 * exist and be actionable, ownership is enforced, and a violation cannot have
 * two active pending appeals (checked in JS AND guaranteed by the DB partial
 * unique index). On success the violation moves to `appealed`.
 */
export async function createViolationAppeal(
  input: NewViolationAppealInput,
  actorAccountant?: string | null
): Promise<ViolationAppeal> {
  const text = input.appeal_text.trim();
  const violation = await getViolation(input.violation_id);
  if (!violation) throw new WorkflowError("Нарушение не найдено", 404);
  const existing = await listViolationAppealsFor(input.violation_id);
  assertCanAppeal(violation, existing, actorAccountant);

  const now = new Date().toISOString();
  const appeal: ViolationAppeal = {
    id: randomUUID(),
    violation_id: input.violation_id,
    accountant: input.accountant ?? violation.accountant ?? null,
    appeal_text: text,
    status: "pending",
    decision_comment: null,
    resolved_by: null,
    created_at: now,
    resolved_at: null,
  };

  const sb = getServiceClient();
  if (sb) {
    const { data, error } = await sb
      .from(TABLES.violationAppeals)
      .insert(appeal)
      .select()
      .single();
    if (error) {
      // Partial unique index (one pending appeal per violation) → race lost.
      if ((error as any).code === "23505") {
        throw new WorkflowError("По этому нарушению уже есть апелляция на рассмотрении", 409);
      }
      throw error;
    }
    await sb
      .from(TABLES.violations)
      .update({ status: "appealed", appeal_status: "appealed" })
      .eq("id", input.violation_id);
    return data as ViolationAppeal;
  }

  const s = store();
  s.violationAppeals.unshift(appeal);
  const v = s.violations.find((x) => x.id === input.violation_id);
  if (v) {
    v.status = "appealed";
    v.appeal_status = "appealed";
  }
  return appeal;
}

/**
 * Margarita's decision on an appeal — «Принять» / «Отклонить». Atomic and
 * idempotent: the update is guarded by `status = 'pending'`, so a page refresh,
 * duplicate submit or concurrent request can never resolve the same appeal
 * twice. Approving moves the violation to `appeal_approved` (its penalty is then
 * excluded from fine totals); rejecting to `appeal_rejected` (violation + fine
 * stay in force). The original violation row is always preserved for history.
 */
export async function resolveViolationAppeal(
  id: string,
  {
    decision,
    resolvedBy,
    decisionComment,
  }: { decision: AppealStatus; resolvedBy?: string | null; decisionComment?: string | null }
): Promise<ViolationAppeal> {
  const now = new Date().toISOString();
  const vStatus = violationStatusForDecision(decision);
  const patch = {
    status: decision,
    resolved_by: resolvedBy ?? null,
    decision_comment: decisionComment?.trim() ? decisionComment.trim() : null,
    resolved_at: now,
  };

  const sb = getServiceClient();
  if (sb) {
    const { data, error } = await sb
      .from(TABLES.violationAppeals)
      .update(patch)
      .eq("id", id)
      .eq("status", "pending") // atomic gate: only an unresolved appeal updates
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      // Either not found, or already resolved.
      const { data: cur } = await sb
        .from(TABLES.violationAppeals)
        .select("id")
        .eq("id", id)
        .maybeSingle();
      throw new WorkflowError(cur ? "Апелляция уже рассмотрена" : "Апелляция не найдена", cur ? 409 : 404);
    }
    await sb
      .from(TABLES.violations)
      .update({ status: vStatus, appeal_status: appealStatusFor(vStatus) })
      .eq("id", (data as ViolationAppeal).violation_id);
    return data as ViolationAppeal;
  }

  const s = store();
  const appeal = s.violationAppeals.find((a) => a.id === id);
  if (!appeal) throw new WorkflowError("Апелляция не найдена", 404);
  assertCanResolve(appeal);
  Object.assign(appeal, patch);
  const v = s.violations.find((x) => x.id === appeal.violation_id);
  if (v) {
    v.status = vStatus;
    v.appeal_status = appealStatusFor(vStatus);
  }
  return appeal;
}

/**
 * Assemble Margarita's violation-workflow report (acknowledgements + appeals)
 * for a day/period, from stored records — works in BOTH Supabase and in-memory
 * modes. The single source used by /work-report, /dashboard and the Telegram
 * daily report so every metric agrees.
 */
export async function getViolationWorkflowReport(filters: {
  from?: string;
  to?: string;
  accountant?: string;
} = {}): Promise<ReturnType<typeof buildViolationWorkflowReport>> {
  const [evaluations, violations, appeals] = await Promise.all([
    listEvaluations({ from: filters.from, to: filters.to, accountant: filters.accountant }),
    listViolations({ from: filters.from, to: filters.to, accountant: filters.accountant }),
    listViolationAppeals({ accountant: filters.accountant }),
  ]);
  // Scope appeals to the window by submission date (created_at).
  const scopedAppeals = appeals.filter((a) => {
    const d = (a.created_at || "").slice(0, 10);
    if (filters.from && d < filters.from) return false;
    if (filters.to && d > filters.to) return false;
    return true;
  });
  return buildViolationWorkflowReport({
    evaluations: evaluations.map((e) => ({
      chat_agr_no: e.chat_agr_no,
      accountant: e.accountant,
      checking_date: e.checking_date,
    })),
    violations,
    appeals: scopedAppeals,
  });
}

// --- Manual score overrides (п.8) ------------------------------------------

/**
 * All manual score overrides, newest first. Append-only history: the latest row
 * per (chat_agr_no, score_date) is the effective override; older rows are the
 * audit trail (кто изменил, когда, старая → новая оценка, комментарий).
 */
export async function listScoreOverrides(chat?: string): Promise<ScoreOverride[]> {
  const sb = getServiceClient();
  if (sb) {
    let q = sb
      .from(TABLES.chatScoreOverrides)
      .select("*")
      .order("created_at", { ascending: false })
      // Lift PostgREST's default ~1000-row cap so no manual override silently
      // drops out of the report once the table grows (see listEvaluations).
      .limit(20000);
    if (chat) q = q.eq("chat_agr_no", chat);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      ...r,
      old_score: r.old_score == null ? null : Number(r.old_score),
      new_score: Number(r.new_score),
    })) as ScoreOverride[];
  }
  const rows = store().scoreOverrides.filter((o) => !chat || o.chat_agr_no === chat);
  return [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function createScoreOverride(
  input: NewScoreOverrideInput
): Promise<ScoreOverride> {
  const row: ScoreOverride = {
    id: randomUUID(),
    chat_agr_no: input.chat_agr_no,
    client_name: input.client_name ?? null,
    score_date: input.score_date.slice(0, 10),
    old_score: input.old_score ?? null,
    new_score: input.new_score,
    changed_by: input.changed_by ?? null,
    comment: input.comment,
    created_at: new Date().toISOString(),
  };
  const sb = getServiceClient();
  if (sb) {
    const { data, error } = await sb
      .from(TABLES.chatScoreOverrides)
      .insert({
        chat_agr_no: row.chat_agr_no,
        client_name: row.client_name,
        score_date: row.score_date,
        old_score: row.old_score,
        new_score: row.new_score,
        changed_by: row.changed_by,
        comment: row.comment,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return {
      ...data,
      old_score: data.old_score == null ? null : Number(data.old_score),
      new_score: Number(data.new_score),
    } as ScoreOverride;
  }
  store().scoreOverrides.push(row);
  return row;
}

// --- Report ----------------------------------------------------------------

export async function getReport(filters: ReportFilters): Promise<DailyReport> {
  const [chats, evaluations, tasks, overrides] = await Promise.all([
    listChats(),
    listEvaluations(filters), // server-side date/accountant/client filter
    listTasks(),
    listScoreOverrides(),
  ]);
  // Judge liveness as of the end of the reported range (or today for an open range).
  const asOf = filters.to ?? new Date().toISOString().slice(0, 10);
  // The accounting report only counts accountant-role evaluations — manager and
  // lawyer per-chat scores live in the same table but are reported separately.
  const accountantEvals = evaluations.filter((e) => e.role === "accountant");
  const report = buildReport(chats, accountantEvals, filters, tasks, asOf, overrides);
  // Item 3: surface manager / lawyer chat-quality scores so those roles land in
  // QA instead of disappearing. They're already window-filtered by listEvaluations.
  report.managerScores = perPersonScores(evaluations.filter((e) => e.role === "manager"));
  report.lawyerScores = perPersonScores(evaluations.filter((e) => e.role === "lawyer"));
  return report;
}

export interface DailyAnalytics {
  /** The report for the resolved window. */
  report: DailyReport;
  /** The immediately-preceding comparable window, for trend (null if no data). */
  previous: DailyReport | null;
  /** The window the report actually covers (resolved when no dates were given). */
  resolved: { from: string; to: string };
}

/**
 * The Telegram "analitika" report: a correctly-scoped daily report PLUS the
 * preceding window for trend. The old /messages page called getReport({}) with
 * NO dates, which silently aggregated the entire history under a "Ежедневный
 * отчёт" header. Here, an empty filter resolves to the latest day that actually
 * has evaluations — a true daily — and we compute the previous day for ▲/▼.
 */
export async function getDailyAnalytics(
  filters: ReportFilters = {}
): Promise<DailyAnalytics> {
  const today = new Date().toISOString().slice(0, 10);
  const [chats, evaluations, tasks, overrides] = await Promise.all([
    listChats(),
    // Pull the accountant/client slice across ALL dates so we can both resolve
    // the default window and aggregate the comparison period from one fetch.
    listEvaluations({ accountant: filters.accountant, client: filters.client }),
    listTasks(),
    listScoreOverrides(),
  ]);
  const accountantEvals = evaluations.filter((e) => e.role === "accountant");
  const evalDates = [
    ...new Set(accountantEvals.map((e) => e.checking_date.slice(0, 10))),
  ].sort();

  // Resolve the window: explicit dates win; otherwise the latest evaluated day.
  let from = filters.from;
  let to = filters.to;
  if (!from && !to) {
    const latest = evalDates[evalDates.length - 1] ?? today;
    from = latest;
    to = latest;
  } else {
    from ??= to;
    to ??= from;
  }

  const curFilters: ReportFilters = { ...filters, from, to };
  const report = buildReport(chats, accountantEvals, curFilters, tasks, to ?? today, overrides);

  const pw = precedingWindow(from!, to!, evalDates);
  let previous: DailyReport | null = null;
  if (pw) {
    const prevReport = buildReport(
      chats,
      accountantEvals,
      { ...filters, from: pw.from, to: pw.to },
      tasks,
      pw.to,
      overrides
    );
    // Only a baseline if it actually has evaluations to compare against.
    if (prevReport.totals.evaluatedChats > 0) previous = prevReport;
  }

  // Item 3 / п.6: surface manager & lawyer per-chat scores on the dashboard too
  // (getReport does this; the live dashboard path did not). Window-scope them to
  // the resolved [from, to] so they match the accountant grid.
  const inWindow = (e: Evaluation): boolean => {
    const d = e.checking_date.slice(0, 10);
    return (!from || d >= from) && (!to || d <= to);
  };
  report.managerScores = perPersonScores(
    evaluations.filter((e) => e.role === "manager" && inWindow(e))
  );
  report.lawyerScores = perPersonScores(
    evaluations.filter((e) => e.role === "lawyer" && inWindow(e))
  );

  return { report, previous, resolved: { from: from!, to: to! } };
}

// --- Report history (saved snapshots) --------------------------------------

export async function listReportSnapshots(): Promise<ReportSnapshot[]> {
  const sb = getServiceClient();
  if (sb) {
    const { data, error } = await sb
      .from(TABLES.reportSnapshots)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    return (data ?? []) as ReportSnapshot[];
  }
  return [...store().reportSnapshots].sort((a, b) =>
    b.created_at.localeCompare(a.created_at)
  );
}

export async function getReportSnapshot(
  id: string
): Promise<ReportSnapshot | null> {
  const sb = getServiceClient();
  if (sb) {
    const { data, error } = await sb
      .from(TABLES.reportSnapshots)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return (data as ReportSnapshot) ?? null;
  }
  return store().reportSnapshots.find((s) => s.id === id) ?? null;
}

/** Compute the report for `filters` right now and persist it to history. */
export async function createReportSnapshot(
  filters: ReportFilters,
  createdBy: string | null
): Promise<ReportSnapshot> {
  const report = await getReport(filters);
  const row: ReportSnapshot = {
    id: randomUUID(),
    label: reportSnapshotLabel(filters),
    filters,
    report,
    created_by: createdBy,
    created_at: new Date().toISOString(),
  };
  const sb = getServiceClient();
  if (sb) {
    const { data, error } = await sb
      .from(TABLES.reportSnapshots)
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    return data as ReportSnapshot;
  }
  store().reportSnapshots.unshift(row);
  return row;
}

// --- Debts ("Долги") — automatic sync from the OneBusiness system -----------

/**
 * Mirror aggregated debts into mqa_debts and refresh mqa_chats.debts (amount) +
 * mqa_chats.debt_status (the «Долги» follow-up status — auto-fills the scoring
 * grid). `byNorm`/`statusByNorm` map a normalized agreement key → totals/status;
 * matched against each chat's normalized agr_no.
 */
export async function syncDebts(
  byNorm: Map<string, DebtTotals>,
  normalize: (s: string) => string,
  statusByNorm: Map<string, string> = new Map()
): Promise<{ updated: number; withDebt: number }> {
  const sb = getServiceClient();
  if (!sb) return { updated: 0, withDebt: 0 };
  const now = new Date().toISOString();

  const { data: chats, error } = await sb
    .from(TABLES.chats)
    .select("agr_no")
    .limit(20000);
  if (error) throw error;

  const debtRows: any[] = [];
  const chatUpdates: { agr_no: string; debts: string; debt_status: string }[] = [];
  let withDebt = 0;
  for (const c of (chats ?? []) as any[]) {
    const norm = normalize(c.agr_no);
    const totals = byNorm.get(norm);
    const debt_status = statusByNorm.get(norm) ?? "Нет долга";
    debtRows.push({
      agr_no: c.agr_no,
      overdue: totals?.overdue ?? 0,
      upcoming: totals?.upcoming ?? 0,
      total: totals?.total ?? 0,
      debt_status,
      as_of: now,
    });
    if (totals && totals.overdue > 0) withDebt++;
    chatUpdates.push({ agr_no: c.agr_no, debts: debtsCellValue(totals), debt_status });
  }

  if (debtRows.length > 0) {
    const { error: de } = await sb
      .from(TABLES.debts)
      .upsert(debtRows, { onConflict: "agr_no" });
    if (de) throw de;
  }
  // Refresh the UI-consumed amount + follow-up status per chat.
  for (const u of chatUpdates) {
    const { error: ce } = await sb
      .from(TABLES.chats)
      .update({ debts: u.debts, debt_status: u.debt_status })
      .eq("agr_no", u.agr_no);
    if (ce) throw ce;
  }
  return { updated: chatUpdates.length, withDebt };
}
