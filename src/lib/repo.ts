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
import { buildReport, type DailyReport, type ReportFilters } from "./report";
import type {
  Accountant,
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
    const { data, error } = await sb
      .from(TABLES.evaluations)
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    return normalizeEvaluation(data);
  }
  store().evaluations.unshift(row);
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
