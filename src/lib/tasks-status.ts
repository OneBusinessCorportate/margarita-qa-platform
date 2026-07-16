// Pure, DB-free derivation of the canonical task lifecycle (Phase 7) on top of
// the existing mqa_tasks rows. Overdue is DERIVED from the due date + status on
// every read (no scheduled DB job), so it can never go stale, and completed /
// cancelled tasks are never overdue. Also the accountant-visibility filter.
//
// The stored `task_status` uses the legacy vocabulary
// ("Completed (On Time)" | "Completed (Late)" | "Overdue" | "Cancelled" | "-");
// we MAP it to the canonical set here so DB rows and TypeScript agree without a
// destructive migration of historical data.

import type { Task } from "./types";

export type CanonicalTaskStatus =
  | "new"
  | "in_progress"
  | "completed"
  | "overdue"
  | "cancelled";

export const CANONICAL_TASK_STATUS_LABEL: Record<CanonicalTaskStatus, string> = {
  new: "Новая",
  in_progress: "В работе",
  completed: "Выполнена",
  overdue: "Просрочена",
  cancelled: "Отменена",
};

/** The date a task is actually due: a postponement overrides the original. */
export function effectiveDueDate(t: Pick<Task, "due_date_original" | "due_date_postponed">): string | null {
  const d = t.due_date_postponed || t.due_date_original;
  return d ? String(d).slice(0, 10) : null;
}

function isCompleted(t: Pick<Task, "task_status" | "completed_at">): boolean {
  if (t.completed_at) return true;
  const s = (t.task_status ?? "").toLowerCase();
  return s.includes("completed") || s.includes("выполн");
}

function isCancelled(t: Pick<Task, "task_status">): boolean {
  const s = (t.task_status ?? "").toLowerCase();
  return s.includes("cancel") || s.includes("отмен");
}

function isInProgress(t: Pick<Task, "task_status" | "status">): boolean {
  const s = `${t.task_status ?? ""} ${t.status ?? ""}`.toLowerCase();
  return s.includes("progress") || s.includes("в работе") || s.includes("in_progress");
}

/**
 * Canonical status as of `asOf` (default today, ISO). Priority:
 *   1. cancelled  — never becomes overdue;
 *   2. completed  — never becomes overdue;
 *   3. overdue    — due date passed and not done/cancelled;
 *   4. in_progress / new.
 */
export function deriveTaskStatus(
  t: Pick<Task, "task_status" | "status" | "completed_at" | "due_date_original" | "due_date_postponed">,
  asOf: string = new Date().toISOString().slice(0, 10)
): CanonicalTaskStatus {
  if (isCancelled(t)) return "cancelled";
  if (isCompleted(t)) return "completed";
  const due = effectiveDueDate(t);
  if (due && due < asOf.slice(0, 10)) return "overdue";
  if (isInProgress(t)) return "in_progress";
  return "new";
}

/** Whether a task is overdue as of `asOf` (completed/cancelled never are). */
export function isTaskOverdue(
  t: Pick<Task, "task_status" | "status" | "completed_at" | "due_date_original" | "due_date_postponed">,
  asOf: string = new Date().toISOString().slice(0, 10)
): boolean {
  return deriveTaskStatus(t, asOf) === "overdue";
}

/**
 * Tasks visible to a viewer. Margarita / management (`canSeeAll`) see every
 * task; an accountant sees ONLY their own (matched by name). Enforced here so
 * both the API and the page share one rule — not just a hidden UI element.
 */
export function visibleTasks<T extends Pick<Task, "accountant">>(
  tasks: T[],
  viewer: { accountant?: string | null; canSeeAll?: boolean }
): T[] {
  if (viewer.canSeeAll) return tasks;
  const name = (viewer.accountant ?? "").trim();
  if (!name) return [];
  return tasks.filter((t) => (t.accountant ?? "").trim() === name);
}
