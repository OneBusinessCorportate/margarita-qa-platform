import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveTaskStatus,
  effectiveDueDate,
  isTaskOverdue,
  visibleTasks,
} from "../src/lib/tasks-status.ts";

const ASOF = "2026-07-16";

test("effectiveDueDate prefers a postponement over the original", () => {
  assert.equal(
    effectiveDueDate({ due_date_original: "2026-07-10", due_date_postponed: "2026-07-20" }),
    "2026-07-20"
  );
  assert.equal(
    effectiveDueDate({ due_date_original: "2026-07-10", due_date_postponed: null }),
    "2026-07-10"
  );
  assert.equal(effectiveDueDate({ due_date_original: null, due_date_postponed: null }), null);
});

test("overdue is derived from the due date when not done/cancelled", () => {
  assert.equal(
    isTaskOverdue({ task_status: "-", status: null, completed_at: null, due_date_original: "2026-07-10", due_date_postponed: null }, ASOF),
    true
  );
  assert.equal(
    isTaskOverdue({ task_status: "-", status: null, completed_at: null, due_date_original: "2026-07-20", due_date_postponed: null }, ASOF),
    false
  );
  // A postponement into the future clears an otherwise-overdue task.
  assert.equal(
    isTaskOverdue({ task_status: "-", status: null, completed_at: null, due_date_original: "2026-07-10", due_date_postponed: "2026-07-25" }, ASOF),
    false
  );
});

test("completed task is never overdue", () => {
  assert.equal(
    isTaskOverdue({ task_status: "Completed (Late)", status: null, completed_at: "2026-07-15", due_date_original: "2026-07-01", due_date_postponed: null }, ASOF),
    false
  );
  assert.equal(
    deriveTaskStatus({ task_status: "Completed (On Time)", status: null, completed_at: "2026-07-01", due_date_original: "2026-07-01", due_date_postponed: null }, ASOF),
    "completed"
  );
});

test("cancelled task is never overdue", () => {
  assert.equal(
    isTaskOverdue({ task_status: "Cancelled", status: null, completed_at: null, due_date_original: "2026-01-01", due_date_postponed: null }, ASOF),
    false
  );
  assert.equal(
    deriveTaskStatus({ task_status: "Cancelled", status: null, completed_at: null, due_date_original: "2026-01-01", due_date_postponed: null }, ASOF),
    "cancelled"
  );
});

test("new / in_progress derivation", () => {
  assert.equal(
    deriveTaskStatus({ task_status: "-", status: null, completed_at: null, due_date_original: "2026-07-20", due_date_postponed: null }, ASOF),
    "new"
  );
  assert.equal(
    deriveTaskStatus({ task_status: "In Progress", status: null, completed_at: null, due_date_original: "2026-07-20", due_date_postponed: null }, ASOF),
    "in_progress"
  );
});

test("visibleTasks: accountant sees only their own; management sees all", () => {
  const tasks = [
    { accountant: "Olya" },
    { accountant: "David" },
    { accountant: "Olya" },
  ];
  assert.equal(visibleTasks(tasks, { canSeeAll: true }).length, 3);
  assert.equal(visibleTasks(tasks, { accountant: "Olya" }).length, 2);
  assert.equal(visibleTasks(tasks, { accountant: "Nobody" }).length, 0);
  // No identity and not management → sees nothing (fail closed).
  assert.equal(visibleTasks(tasks, {}).length, 0);
});
