// Data-access layer. Uses Supabase when configured; otherwise the in-memory
// mock store. Both paths return the same domain types so the UI is agnostic.
import { randomUUID } from "crypto";
import { getServiceClient } from "./supabase/server";
import { store } from "./mock-store";
import { TABLES } from "./tables";
import {
  CRITERIA,
  bandFor,
  computeKpiScore,
  computeOverall,
  computeRegistrationScore,
  isoWeekLabel,
  mondayOf,
} from "./scoring";
import {
  buildReport,
  precedingWindow,
  reportSnapshotLabel,
  type DailyReport,
  type ReportFilters,
  type ReportSnapshot,
} from "./report";
import { type Candidate, type UnansweredLabel, type Verdict } from "./unanswered";
import type { DebtTotals } from "./debts";
import { debtsCellValue } from "./debts";
import type {
  Accountant,
  ActiveExclusion,
  Chat,
  Evaluation,
  ManagerEvaluation,
  NewEvaluationInput,
  NewManagerEvaluationInput,
  NewTaskInput,
  NewViolationInput,
  Task,
  Violation,
} from "./types";

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

// --- Accountants -----------------------------------------------------------

export async function listAccountants(): Promise<Accountant[]> {
  const sb = getServiceClient();
  if (sb) {
    const { data, error } = await sb.from(TABLES.accountants).select("*").order("name");
    if (error) throw error;
    return (data ?? []) as Accountant[];
  }
  return store().accountants;
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

// --- Manager evaluations (Регистрация — еженедельно) -----------------------

function normalizeManagerEval(row: any): ManagerEvaluation {
  return { ...row, total_score: Number(row.total_score) } as ManagerEvaluation;
}

function managerTotalFor(input: NewManagerEvaluationInput): number {
  if (typeof input.total_override === "number") return input.total_override;
  return computeRegistrationScore(input.scores.registration ?? {});
}

export async function listManagerEvaluations(
  filters: { from?: string; to?: string; manager?: string } = {}
): Promise<ManagerEvaluation[]> {
  const sb = getServiceClient();
  if (sb) {
    let q = sb.from(TABLES.managerEvaluations).select("*");
    if (filters.from) q = q.gte("week_start", filters.from);
    if (filters.to) q = q.lte("week_start", filters.to);
    if (filters.manager) q = q.eq("manager", filters.manager);
    const { data, error } = await q
      .order("week_start", { ascending: false })
      .limit(5000);
    if (error) throw error;
    return (data ?? []).map(normalizeManagerEval);
  }
  let rows = [...store().managerEvaluations].sort((a, b) =>
    b.week_start.localeCompare(a.week_start)
  );
  if (filters.from) rows = rows.filter((r) => r.week_start >= filters.from!);
  if (filters.to) rows = rows.filter((r) => r.week_start <= filters.to!);
  if (filters.manager) rows = rows.filter((r) => r.manager === filters.manager);
  return rows;
}

export async function createManagerEvaluation(
  input: NewManagerEvaluationInput
): Promise<ManagerEvaluation> {
  const week_start = mondayOf(input.week_start);
  const total = managerTotalFor(input);
  const row: ManagerEvaluation = {
    id: randomUUID(),
    manager: input.manager,
    week_start,
    period: input.period ?? isoWeekLabel(week_start),
    scores: input.scores,
    total_score: total,
    quality_band: bandFor(total),
    comment: input.comment ?? null,
    created_at: new Date().toISOString(),
  };
  const sb = getServiceClient();
  if (sb) {
    const { data, error } = await sb
      .from(TABLES.managerEvaluations)
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    return normalizeManagerEval(data);
  }
  store().managerEvaluations.unshift(row);
  return row;
}

export async function updateManagerEvaluation(
  id: string,
  input: NewManagerEvaluationInput
): Promise<ManagerEvaluation> {
  const week_start = mondayOf(input.week_start);
  const total = managerTotalFor(input);
  const patch = {
    manager: input.manager,
    week_start,
    period: input.period ?? isoWeekLabel(week_start),
    scores: input.scores,
    total_score: total,
    quality_band: bandFor(total),
    comment: input.comment ?? null,
  };
  const sb = getServiceClient();
  if (sb) {
    const { data, error } = await sb
      .from(TABLES.managerEvaluations)
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return normalizeManagerEval(data);
  }
  const rows = store().managerEvaluations;
  const idx = rows.findIndex((r) => r.id === id);
  if (idx === -1) throw new Error(`Manager evaluation ${id} not found`);
  rows[idx] = { ...rows[idx], ...patch };
  return rows[idx];
}

// --- Tasks -----------------------------------------------------------------

export async function listTasks(chatAgrNo?: string): Promise<Task[]> {
  const sb = getServiceClient();
  if (sb) {
    let q = sb.from(TABLES.tasks).select("*");
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

// --- Active-list exclusions ("Скрыть из активных за день") ------------------

/** Chats QA manually hid from the "Активные за день" list, per (chat, day). */
export async function listActiveExclusions(): Promise<ActiveExclusion[]> {
  const sb = getServiceClient();
  if (sb) {
    const { data, error } = await sb
      .from(TABLES.activeExclusions)
      .select("agr_no, exclude_date");
    if (error) throw error;
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

// --- Report ----------------------------------------------------------------

export async function getReport(filters: ReportFilters): Promise<DailyReport> {
  const [chats, evaluations, tasks] = await Promise.all([
    listChats(),
    listEvaluations(filters), // server-side date/accountant/client filter
    listTasks(),
  ]);
  // Judge liveness as of the end of the reported range (or today for an open range).
  const asOf = filters.to ?? new Date().toISOString().slice(0, 10);
  // The accounting report only counts accountant-role evaluations — manager and
  // lawyer per-chat scores live in the same table but are reported separately.
  const accountantEvals = evaluations.filter((e) => e.role === "accountant");
  return buildReport(chats, accountantEvals, filters, tasks, asOf);
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
  const [chats, evaluations, tasks] = await Promise.all([
    listChats(),
    // Pull the accountant/client slice across ALL dates so we can both resolve
    // the default window and aggregate the comparison period from one fetch.
    listEvaluations({ accountant: filters.accountant, client: filters.client }),
    listTasks(),
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
  const report = buildReport(chats, accountantEvals, curFilters, tasks, to ?? today);

  const pw = precedingWindow(from!, to!, evalDates);
  let previous: DailyReport | null = null;
  if (pw) {
    const prevReport = buildReport(
      chats,
      accountantEvals,
      { ...filters, from: pw.from, to: pw.to },
      tasks,
      pw.to
    );
    // Only a baseline if it actually has evaluations to compare against.
    if (prevReport.totals.evaluatedChats > 0) previous = prevReport;
  }

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

// --- Unanswered ("Без ответа") — canonical QA/SLA detection ----------------
// Detection comes from public.mqa_unanswered_queue → public.qa_unanswered_chats
// (working-hours SLA clock, meaningful/strong-request, substantive staff reply,
// closing/nudge/self-resolve, data-completeness, staff-role detection — per the
// QA SLA spec). We only show chats WE owe a reply on.

/** Which slice of the «Без ответа» queue to show. */
export type UnansweredMode = "unanswered" | "watched";

/** A row on the «Без ответа» page (longest wait first). */
export interface UnansweredQueueItem {
  agr_no: string;
  chat_name: string;
  accountant: string | null;
  chat_link: string | null;
  debts: string | null;
  /** The client message that opened the obligation. */
  problem_text: string | null;
  problem_at: string | null;
  /** Working hours waited (Yerevan business hours), per the canonical RPC. */
  hours_ago: number | null;
  severity: string | null; // critical | minor
  classification: string; // unanswered | problematic_not_critical | needs_human_review | answered
  flag_reason: string | null;
  human_unanswered: boolean | null;
  human_status: string | null;
  watched: boolean;
}

/** Counts for the page's filter tabs. */
export interface UnansweredCounts {
  unanswered: number;
  watched: number;
}

/**
 * The «Без ответа» queue, straight from the canonical QA/SLA RPC. Shows only the
 * chats WE owe a reply on (classification = 'unanswered'), or, in `watched` mode,
 * the ones Margarita put «на контроле». Longest working-hours wait first.
 */
export async function listUnansweredQueue(
  mode: UnansweredMode = "unanswered"
): Promise<{ items: UnansweredQueueItem[]; counts: UnansweredCounts }> {
  const empty = { items: [], counts: { unanswered: 0, watched: 0 } };
  const sb = getServiceClient();
  if (!sb) return empty;

  const { data, error } = await sb.rpc("mqa_unanswered_queue", {
    p_threshold_hours: 2,
  });
  if (error) throw error;

  const all: UnansweredQueueItem[] = ((data ?? []) as any[]).map((r) => ({
    agr_no: r.agr_no,
    chat_name: r.chat_name,
    accountant: r.accountant ?? null,
    chat_link: r.chat_link ?? null,
    debts: r.debts ?? null,
    problem_text: r.problem_text ?? null,
    problem_at: r.problem_at ?? null,
    hours_ago: r.hours_ago != null ? Number(r.hours_ago) : null,
    severity: r.severity ?? null,
    classification: r.classification,
    flag_reason: r.flag_reason ?? null,
    human_unanswered: r.human_unanswered ?? null,
    human_status: r.human_status ?? null,
    watched: r.watched === true,
  }));

  const counts: UnansweredCounts = {
    unanswered: all.filter((x) => x.classification === "unanswered").length,
    watched: all.filter((x) => x.watched).length,
  };

  const items = (
    mode === "watched"
      ? all.filter((x) => x.watched)
      : all.filter((x) => x.classification === "unanswered")
  ).sort((a, b) => (b.hours_ago ?? 0) - (a.hours_ago ?? 0)); // longest wait first

  return { items, counts };
}

/** A «Поздний ответ» row: answered, but the client waited past SLA. */
export interface LateAnswerItem {
  agr_no: string;
  chat_name: string;
  accountant: string | null;
  chat_link: string | null;
  hours_ago: number | null;
  problem_text: string | null;
  responder_name: string | null;
}

/** Recently answered chats where the client waited past SLA (working hours). */
export async function listLateAnswers(): Promise<LateAnswerItem[]> {
  const sb = getServiceClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc("mqa_late_answers", { p_sla_hours: 2 });
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => ({
    agr_no: r.agr_no,
    chat_name: r.chat_name,
    accountant: r.accountant ?? null,
    chat_link: r.chat_link ?? null,
    hours_ago: r.hours_ago != null ? Number(r.hours_ago) : null,
    problem_text: r.problem_text ?? null,
    responder_name: r.responder_name ?? null,
  }));
}

/** Toggle «на контроле» (her "mark it") for a chat — persisted across re-analysis. */
export async function setUnansweredWatched(
  agrNo: string,
  watched: boolean
): Promise<void> {
  const sb = getServiceClient();
  if (!sb) throw new Error("Supabase not configured");
  const { error } = await sb.from(TABLES.unanswered).upsert(
    {
      agr_no: agrNo,
      watched,
      watched_at: watched ? new Date().toISOString() : null,
    },
    { onConflict: "agr_no" }
  );
  if (error) throw error;
}

/** Candidates for AI analysis (client wrote last, recent, not yet analyzed). */
export async function getUnansweredCandidates(
  limit = 40,
  days = 14
): Promise<Candidate[]> {
  const sb = getServiceClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc("mqa_unanswered_candidates", {
    p_limit: limit,
    p_days: days,
  });
  if (error) throw error;
  return (data ?? []) as Candidate[];
}

/** Past confirmed labels, newest first — few-shot training data for the prompt. */
export async function listUnansweredLabels(
  limit = 60
): Promise<UnansweredLabel[]> {
  const sb = getServiceClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from(TABLES.unansweredLabels)
    .select("last_msg_text, ai_unanswered, human_unanswered")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as UnansweredLabel[];
}

/**
 * Persist a batch of AI verdicts: upsert mqa_unanswered (resetting any prior
 * human confirmation — the verdict is for a NEW last message) and reflect the
 * verdict into mqa_chats.unanswered immediately so the badge updates without
 * waiting for the cron.
 */
export async function recordUnansweredVerdicts(
  verdicts: Verdict[],
  candidates: Candidate[]
): Promise<number> {
  const sb = getServiceClient();
  if (!sb || verdicts.length === 0) return 0;
  const candByAgr = new Map(candidates.map((c) => [c.agr_no, c]));
  const now = new Date().toISOString();

  const rows = verdicts
    .filter((v) => candByAgr.has(v.agr_no))
    .map((v) => {
      const c = candByAgr.get(v.agr_no)!;
      return {
        agr_no: v.agr_no,
        chat_id: c.chat_id,
        last_msg_at: c.last_msg_at,
        last_msg_text: c.last_msg_text,
        ai_unanswered: v.unanswered,
        ai_waiting_on: v.waiting_on,
        ai_reason: v.reason,
        ai_confidence: v.confidence,
        human_unanswered: null,
        human_at: null,
        analyzed_at: now,
      };
    });
  if (rows.length === 0) return 0;

  const { error } = await sb
    .from(TABLES.unanswered)
    .upsert(rows, { onConflict: "agr_no" });
  if (error) throw error;

  // Reflect verdicts into the consumed signal right away.
  for (const v of verdicts) {
    if (!candByAgr.has(v.agr_no)) continue;
    const { error: ue } = await sb
      .from(TABLES.chats)
      .update({ unanswered: v.unanswered })
      .eq("agr_no", v.agr_no);
    if (ue) throw ue;
  }
  return rows.length;
}

/** The status Margarita picks per chat (her dropdown). */
export type HumanStatus = "waiting" | "warned" | "answered";

/**
 * Record Margarita's per-row status (her dropdown habit from «КК Сопровождение»):
 *   waiting  — ждёт ответа (we still owe a reply)
 *   warned   — предупредила бухгалтера (warned the accountant; still ours)
 *   answered — ответили (resolved)
 * human_unanswered (the badge signal) is derived: answered → false, else true.
 * Appends a training label, pins the verdict scoped to the current message, and
 * sets mqa_chats.unanswered.
 */
export async function recordUnansweredLabel(
  agrNo: string,
  status: HumanStatus,
  createdBy: string | null
): Promise<void> {
  const sb = getServiceClient();
  if (!sb) throw new Error("Supabase not configured");
  const humanUnanswered = status !== "answered";

  const [{ data: cur }, { data: chat }] = await Promise.all([
    sb
      .from(TABLES.unanswered)
      .select("chat_id, last_msg_at, last_msg_text, ai_unanswered, ai_reason")
      .eq("agr_no", agrNo)
      .maybeSingle(),
    sb
      .from(TABLES.chats)
      .select("last_activity_at")
      .eq("agr_no", agrNo)
      .maybeSingle(),
  ]);

  const { error: le } = await sb.from(TABLES.unansweredLabels).insert({
    agr_no: agrNo,
    chat_id: cur?.chat_id ?? null,
    last_msg_text: cur?.last_msg_text ?? null,
    ai_unanswered: cur?.ai_unanswered ?? null,
    ai_reason: cur?.ai_reason ?? null,
    human_unanswered: humanUnanswered,
    created_by: createdBy,
  });
  if (le) throw le;

  const now = new Date().toISOString();
  // Pin the verdict + status, scoped to the chat's CURRENT message, so a later
  // message after the QA re-opens the chat instead of the verdict sticking.
  const { error: ue } = await sb.from(TABLES.unanswered).upsert(
    {
      agr_no: agrNo,
      chat_id: cur?.chat_id ?? null,
      last_msg_at: chat?.last_activity_at ?? cur?.last_msg_at ?? null,
      human_unanswered: humanUnanswered,
      human_status: status,
      human_at: now,
    },
    { onConflict: "agr_no" }
  );
  if (ue) throw ue;

  const { error: ce } = await sb
    .from(TABLES.chats)
    .update({ unanswered: humanUnanswered })
    .eq("agr_no", agrNo);
  if (ce) throw ce;
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
