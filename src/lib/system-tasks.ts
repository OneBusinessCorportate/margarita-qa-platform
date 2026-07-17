// Pure, DB-free rules for the «Системные задачи бухгалтеров» tracker (п.6).
// Kept side-effect-free so validation, status vocabulary, completion handling,
// the accountant-visibility filter and the per-accountant/status summary are all
// unit-testable without a database and shared by the repo + API routes.
//
// This tracker is DELIBERATELY separate from appeals (ViolationAppeal) and from
// the chat-bound tasks (Task): different table, different lifecycle.

import type {
  AccountantSystemTask,
  SystemTaskPatch,
  SystemTaskPriority,
  SystemTaskStatus,
} from "./types";

export const SYSTEM_TASK_STATUSES: SystemTaskStatus[] = [
  "new",
  "in_progress",
  "postponed",
  "completed",
  "cancelled",
];

export const SYSTEM_TASK_STATUS_LABEL: Record<SystemTaskStatus, string> = {
  new: "Новая",
  in_progress: "В работе",
  postponed: "Отложена",
  completed: "Выполнена",
  cancelled: "Отменена",
};

export const SYSTEM_TASK_PRIORITIES: SystemTaskPriority[] = ["Low", "Medium", "High"];

export const SYSTEM_TASK_PRIORITY_LABEL: Record<SystemTaskPriority, string> = {
  Low: "Низкий",
  Medium: "Средний",
  High: "Высокий",
};

export class SystemTaskError extends Error {
  readonly httpStatus: number;
  constructor(message: string, httpStatus = 400) {
    super(message);
    this.name = "SystemTaskError";
    this.httpStatus = httpStatus;
  }
}

export function isSystemTaskStatus(v: unknown): v is SystemTaskStatus {
  return typeof v === "string" && (SYSTEM_TASK_STATUSES as string[]).includes(v);
}

export function isSystemTaskPriority(v: unknown): v is SystemTaskPriority {
  return typeof v === "string" && (SYSTEM_TASK_PRIORITIES as string[]).includes(v);
}

/** Validate + trim a task title. Empty/whitespace-only is rejected. */
export function validateTitle(title: unknown): string {
  if (typeof title !== "string" || title.trim() === "") {
    throw new SystemTaskError("Название задачи обязательно", 400);
  }
  return title.trim();
}

/**
 * Whether a status change to `completed` should stamp `completed_at`, and
 * whether leaving `completed` should clear it. Returns the value to store
 * (ISO string when completing, null otherwise) — `now` is injected for testability.
 */
export function completedAtFor(
  status: SystemTaskStatus,
  now: string
): string | null {
  return status === "completed" ? now : null;
}

/**
 * Normalize a PATCH into the fields to persist. Validates enum values and the
 * title; when the status becomes `completed` we set `completed_at` (unless the
 * caller supplied one explicitly), and clear it when moving away from completed.
 */
export function normalizeSystemTaskPatch(
  patch: SystemTaskPatch,
  now: string
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (patch.status !== undefined) {
    if (!isSystemTaskStatus(patch.status)) {
      throw new SystemTaskError(`Недопустимый статус: ${patch.status}`, 400);
    }
    fields.status = patch.status;
    // Keep completed_at consistent with the status unless explicitly provided.
    if (patch.completed_at === undefined) {
      fields.completed_at = completedAtFor(patch.status, now);
    }
  }
  if (patch.priority !== undefined) {
    if (!isSystemTaskPriority(patch.priority)) {
      throw new SystemTaskError(`Недопустимый приоритет: ${patch.priority}`, 400);
    }
    fields.priority = patch.priority;
  }
  if (patch.title !== undefined) fields.title = validateTitle(patch.title);
  if (patch.description !== undefined) fields.description = patch.description || null;
  if (patch.accountant_name !== undefined) fields.accountant_name = patch.accountant_name || null;
  if (patch.client_name !== undefined) fields.client_name = patch.client_name || null;
  if (patch.chat_id !== undefined) fields.chat_id = patch.chat_id || null;
  if (patch.ticket_id !== undefined) fields.ticket_id = patch.ticket_id || null;
  if (patch.due_date_original !== undefined)
    fields.due_date_original = patch.due_date_original || null;
  if (patch.due_date_postponed !== undefined)
    fields.due_date_postponed = patch.due_date_postponed || null;
  if (patch.completed_at !== undefined) fields.completed_at = patch.completed_at || null;
  return fields;
}

/** The date a task is actually due: a postponement overrides the original. */
export function effectiveDueDate(
  t: Pick<AccountantSystemTask, "due_date_original" | "due_date_postponed">
): string | null {
  const d = t.due_date_postponed || t.due_date_original;
  return d ? String(d).slice(0, 10) : null;
}

/** Open = not completed and not cancelled. */
export function isOpen(t: Pick<AccountantSystemTask, "status">): boolean {
  return t.status !== "completed" && t.status !== "cancelled";
}

/**
 * Tasks visible to a viewer. Margarita / management (`canSeeAll`) see every
 * task; an accountant sees ONLY their own (matched by name). Same rule shape as
 * the chat-task tracker so both share one visibility contract.
 */
export function visibleSystemTasks<T extends Pick<AccountantSystemTask, "accountant_name">>(
  tasks: T[],
  viewer: { accountant?: string | null; canSeeAll?: boolean }
): T[] {
  if (viewer.canSeeAll) return tasks;
  const name = (viewer.accountant ?? "").trim();
  if (!name) return [];
  return tasks.filter((t) => (t.accountant_name ?? "").trim() === name);
}

export interface SystemTaskStatusCounts {
  total: number;
  new: number;
  in_progress: number;
  postponed: number;
  completed: number;
  cancelled: number;
  open: number;
}

export interface SystemTaskAccountantRow extends SystemTaskStatusCounts {
  accountant: string;
}

export interface SystemTaskSummary extends SystemTaskStatusCounts {
  byAccountant: SystemTaskAccountantRow[];
}

function emptyCounts(): SystemTaskStatusCounts {
  return {
    total: 0,
    new: 0,
    in_progress: 0,
    postponed: 0,
    completed: 0,
    cancelled: 0,
    open: 0,
  };
}

function tally(counts: SystemTaskStatusCounts, status: SystemTaskStatus): void {
  counts.total += 1;
  counts[status] += 1;
  if (status !== "completed" && status !== "cancelled") counts.open += 1;
}

/**
 * Overall + per-accountant counts by status — for the tracker header and any
 * report. Deterministic order: most open tasks first, then name.
 */
export function summarizeSystemTasks(tasks: AccountantSystemTask[]): SystemTaskSummary {
  const overall = emptyCounts();
  const rows = new Map<string, SystemTaskAccountantRow>();
  for (const t of tasks) {
    tally(overall, t.status);
    const key = (t.accountant_name ?? "").trim() || "— Не назначено —";
    if (!rows.has(key)) rows.set(key, { accountant: key, ...emptyCounts() });
    tally(rows.get(key)!, t.status);
  }
  const byAccountant = [...rows.values()].sort(
    (a, b) => b.open - a.open || b.total - a.total || a.accountant.localeCompare(b.accountant)
  );
  return { ...overall, byAccountant };
}
