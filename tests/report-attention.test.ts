import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport } from "../src/lib/report";
import { seedChats, seedEvaluations, seedTasks } from "../src/lib/seed-data";

// Accountant names are read from the data (the seed mixes Armenian/Cyrillic
// glyphs that are easy to mistype), so these tests stay glyph-agnostic.
const accOfChat = (agrNo: string) =>
  seedEvaluations.find((e) => e.chat_agr_no === agrNo)!.accountant!;

test("needsAttention flags critical scorers and overdue tasks, most urgent first", () => {
  const avag = accOfChat("180"); // e5: salary not requested -> Критично, + overdue task t4
  const stella = accOfChat("28"); // e8: taxes not sent -> Критично, no overdue tasks

  const r = buildReport(seedChats, seedEvaluations, {}, seedTasks);
  // Everyone else is Хорошо/Отлично with no overdue tasks -> not flagged.
  assert.equal(r.needsAttention.length, 2);

  const [first, second] = r.needsAttention;
  // Tie on criticalCount (1 each) is broken by overdue tasks -> avag first.
  assert.equal(first.accountant, avag);
  assert.equal(first.criticalCount, 1);
  assert.equal(first.overdueTasks, 1);
  assert.ok(first.reasons.some((x) => x.includes("критичных чатов")));
  assert.ok(first.reasons.some((x) => x.includes("просрочено задач")));

  assert.equal(second.accountant, stella);
  assert.equal(second.criticalCount, 1);
  assert.equal(second.overdueTasks, 0);
});

test("needsAttention is empty when the filtered scope has no problems", () => {
  // chat 59's accountant: one perfect chat (100), only a late task (not overdue).
  const clean = accOfChat("59");
  const r = buildReport(seedChats, seedEvaluations, { accountant: clean }, seedTasks);
  assert.equal(r.needsAttention.length, 0);
});

test("a chat flagged only for overdue tasks (no evaluations) still surfaces", () => {
  // No evaluations at all, but one accountant has an overdue task.
  const overdueAcc = seedTasks.find((t) => t.task_status === "Overdue")!.accountant!;
  const r = buildReport(seedChats, [], {}, seedTasks);
  const item = r.needsAttention.find((a) => a.accountant === overdueAcc);
  assert.ok(item, "accountant with an overdue task must be flagged");
  assert.equal(item!.avgScore, -1); // no evaluations
  assert.equal(item!.band, null);
  assert.equal(item!.overdueTasks, 1);
  assert.ok(item!.reasons.some((x) => x.includes("просрочено задач")));
});
