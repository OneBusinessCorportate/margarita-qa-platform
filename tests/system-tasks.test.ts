import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SystemTaskError,
  completedAtFor,
  isSystemTaskPriority,
  isSystemTaskStatus,
  normalizeSystemTaskPatch,
  summarizeSystemTasks,
  validateTitle,
  visibleSystemTasks,
} from "../src/lib/system-tasks.ts";
import type { AccountantSystemTask } from "../src/lib/types.ts";

const NOW = "2026-07-17T12:00:00.000Z";

function task(over: Partial<AccountantSystemTask> = {}): AccountantSystemTask {
  return {
    id: "t1",
    ticket_id: null,
    accountant_name: null,
    client_name: null,
    chat_id: null,
    title: "Задача",
    description: null,
    priority: "Medium",
    status: "new",
    due_date_original: null,
    due_date_postponed: null,
    completed_at: null,
    created_by: null,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  };
}

test("enum guards", () => {
  assert.equal(isSystemTaskStatus("in_progress"), true);
  assert.equal(isSystemTaskStatus("done"), false);
  assert.equal(isSystemTaskPriority("High"), true);
  assert.equal(isSystemTaskPriority("Urgent"), false);
});

test("validateTitle trims and rejects empty", () => {
  assert.equal(validateTitle("  сделать  "), "сделать");
  assert.throws(() => validateTitle("   "), SystemTaskError);
  assert.throws(() => validateTitle(undefined), SystemTaskError);
});

test("completedAtFor stamps only when completed", () => {
  assert.equal(completedAtFor("completed", NOW), NOW);
  assert.equal(completedAtFor("in_progress", NOW), null);
  assert.equal(completedAtFor("cancelled", NOW), null);
});

test("normalizeSystemTaskPatch: completing stamps completed_at, leaving clears it", () => {
  assert.deepEqual(normalizeSystemTaskPatch({ status: "completed" }, NOW), {
    status: "completed",
    completed_at: NOW,
  });
  assert.deepEqual(normalizeSystemTaskPatch({ status: "in_progress" }, NOW), {
    status: "in_progress",
    completed_at: null,
  });
});

test("normalizeSystemTaskPatch: explicit completed_at is respected over the derived one", () => {
  const out = normalizeSystemTaskPatch(
    { status: "completed", completed_at: "2026-07-10T00:00:00Z" },
    NOW
  );
  assert.equal(out.status, "completed");
  assert.equal(out.completed_at, "2026-07-10T00:00:00Z");
});

test("normalizeSystemTaskPatch rejects bad enums", () => {
  assert.throws(() => normalizeSystemTaskPatch({ status: "done" as any }, NOW), SystemTaskError);
  assert.throws(() => normalizeSystemTaskPatch({ priority: "X" as any }, NOW), SystemTaskError);
});

test("normalizeSystemTaskPatch blanks empty strings to null", () => {
  const out = normalizeSystemTaskPatch(
    { description: "", chat_id: "", due_date_postponed: "" },
    NOW
  );
  assert.equal(out.description, null);
  assert.equal(out.chat_id, null);
  assert.equal(out.due_date_postponed, null);
});

test("visibleSystemTasks: accountant sees only own, canSeeAll sees all", () => {
  const tasks = [task({ accountant_name: "Гаяне" }), task({ id: "t2", accountant_name: "Ани" })];
  assert.equal(visibleSystemTasks(tasks, { canSeeAll: true }).length, 2);
  assert.equal(visibleSystemTasks(tasks, { accountant: "Гаяне" }).length, 1);
  assert.equal(visibleSystemTasks(tasks, {}).length, 0);
});

test("summarizeSystemTasks counts overall + per accountant, open excludes done/cancelled", () => {
  const tasks = [
    task({ id: "1", accountant_name: "Гаяне", status: "new" }),
    task({ id: "2", accountant_name: "Гаяне", status: "in_progress" }),
    task({ id: "3", accountant_name: "Гаяне", status: "completed" }),
    task({ id: "4", accountant_name: "Ани", status: "postponed" }),
    task({ id: "5", accountant_name: "Ани", status: "cancelled" }),
  ];
  const s = summarizeSystemTasks(tasks);
  assert.equal(s.total, 5);
  assert.equal(s.new, 1);
  assert.equal(s.in_progress, 1);
  assert.equal(s.postponed, 1);
  assert.equal(s.completed, 1);
  assert.equal(s.cancelled, 1);
  assert.equal(s.open, 3); // new + in_progress + postponed
  const gayane = s.byAccountant.find((r) => r.accountant === "Гаяне")!;
  assert.equal(gayane.total, 3);
  assert.equal(gayane.open, 2);
  const ani = s.byAccountant.find((r) => r.accountant === "Ани")!;
  assert.equal(ani.open, 1); // postponed open, cancelled not
});

test("summarizeSystemTasks buckets unnamed accountant", () => {
  const s = summarizeSystemTasks([task({ accountant_name: null })]);
  assert.equal(s.byAccountant[0].accountant, "— Не назначено —");
});
