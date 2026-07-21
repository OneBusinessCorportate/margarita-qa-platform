import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMargaritaWorkReportMessage } from "../src/lib/templates.ts";
import type { ViolationWorkflowReport } from "../src/lib/appeals-report.ts";

function report(over: Partial<ViolationWorkflowReport> = {}): ViolationWorkflowReport {
  return {
    chatsChecked: 0,
    evaluations: 0,
    violationsCreated: 0,
    accountantsWithViolations: 0,
    acknowledged: 0,
    appealsSubmitted: 0,
    appealsPending: 0,
    appealsApproved: 0,
    appealsRejected: 0,
    appealsProcessed: 0,
    unresolvedAppeals: 0,
    unprocessedViolations: 0,
    penaltiesCancelled: 0,
    appealProcessingPct: 0,
    acknowledgementPct: 0,
    byAccountant: [],
    ...over,
  };
}

test("header and totals are rendered", () => {
  const msg = buildMargaritaWorkReportMessage(
    report({
      chatsChecked: 12,
      violationsCreated: 5,
      acknowledged: 2,
      appealsSubmitted: 3,
      appealsApproved: 1,
      appealsRejected: 1,
      appealsPending: 1,
      unprocessedViolations: 1,
    }),
    { date: "2026-07-16", activeChats: 40 }
  );
  assert.match(msg, /Отчет по работе QA Маргариты 16\.07\.2026/);
  // Проверено чатов: N из <активных>
  assert.match(msg, /Проверено чатов: 12 из 40/);
  // Создано тикетов: N (процент от активных чатов) — 5/40 = 13%
  assert.match(msg, /Создано тикетов: 5 \(13%\)/);
  // Аппеляции бухгалтеров
  assert.match(msg, /!!! Тикеты без реакций бухгалтеров: 1/);
  assert.match(msg, /Всего реакций: 5/); // acknowledged(2) + appeals(3)
  assert.match(msg, /— Ознакомлений: 2/);
  assert.match(msg, /— Апелляций: 3/);
  // Реакция Маргариты на аппеляции
  assert.match(msg, /!!! Аппеляций без реакции Маргариты: 1/);
  assert.match(msg, /Всего реакций: 2/); // approved(1) + rejected(1)
  assert.match(msg, /— Подтверждено: 1/);
  assert.match(msg, /— Отклонено: 1/);
});

test("«!!!» alert lines show the all-time backlog, not the day's slice", () => {
  const msg = buildMargaritaWorkReportMessage(
    // Day is quiet: 0 unprocessed / 0 pending FOR THE DAY...
    report({ chatsChecked: 5, violationsCreated: 0, appealsPending: 0, unprocessedViolations: 0 }),
    // ...but the standing backlog is 129 tickets and 3 appeals.
    { activeChats: 40, unprocessedBacklog: 129, pendingBacklog: 3 }
  );
  assert.match(msg, /!!! Тикеты без реакций бухгалтеров: 129/);
  assert.match(msg, /!!! Аппеляций без реакции Маргариты: 3/);
});

test("without a backlog option the «!!!» lines fall back to the day's values", () => {
  const msg = buildMargaritaWorkReportMessage(
    report({ unprocessedViolations: 2, appealsPending: 1 }),
    { activeChats: 40 }
  );
  assert.match(msg, /!!! Тикеты без реакций бухгалтеров: 2/);
  assert.match(msg, /!!! Аппеляций без реакции Маргариты: 1/);
});

test("active chats unknown → «…» and 0% (never divide by an unknown)", () => {
  const msg = buildMargaritaWorkReportMessage(
    report({ chatsChecked: 3, violationsCreated: 2 })
    // no activeChats passed
  );
  assert.match(msg, /Проверено чатов: 3 из …/);
  assert.match(msg, /Создано тикетов: 2 \(0%\)/);
});

test("a quiet day renders the same zero-filled form", () => {
  const msg = buildMargaritaWorkReportMessage(report(), { activeChats: 40 });
  assert.match(msg, /Отчет по работе QA Маргариты/);
  assert.match(msg, /Проверено чатов: 0 из 40/);
  assert.match(msg, /Создано тикетов: 0 \(0%\)/);
  assert.match(msg, /!!! Тикеты без реакций бухгалтеров: 0/);
  assert.match(msg, /!!! Аппеляций без реакции Маргариты: 0/);
});
