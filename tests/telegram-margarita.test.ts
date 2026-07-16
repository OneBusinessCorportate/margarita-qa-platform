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
      byAccountant: [
        {
          name: "Гаяне",
          chatsChecked: 4,
          evaluations: 4,
          violations: 3,
          acknowledgements: 1,
          appealsSubmitted: 2,
          approved: 1,
          rejected: 0,
          pending: 1,
          unprocessed: 1,
        },
      ],
    }),
    { date: "2026-07-16" }
  );
  assert.match(msg, /Работа Маргариты за день/);
  assert.match(msg, /Проверено чатов: 12/);
  assert.match(msg, /Создано нарушений: 5/);
  assert.match(msg, /Ознакомлено бухгалтерами: 2/);
  assert.match(msg, /Подано апелляций: 3/);
  assert.match(msg, /Принято апелляций: 1/);
  assert.match(msg, /Отклонено апелляций: 1/);
  assert.match(msg, /Ожидают решения: 1/);
  assert.match(msg, /Не обработано бухгалтерами: 1/);
});

test("per-accountant breakdown is formatted", () => {
  const msg = buildMargaritaWorkReportMessage(
    report({
      violationsCreated: 3,
      byAccountant: [
        {
          name: "Гаяне",
          chatsChecked: 0,
          evaluations: 0,
          violations: 3,
          acknowledgements: 1,
          appealsSubmitted: 2,
          approved: 1,
          rejected: 0,
          pending: 1,
          unprocessed: 1,
        },
      ],
    })
  );
  assert.match(msg, /\nГаяне\nНарушений: 3\nОзнакомлено: 1\nАпелляций: 2\nПринято: 1\nОтклонено: 0\nОжидают решения: 1/);
});

test("a quiet day says so instead of a bare zero wall", () => {
  const msg = buildMargaritaWorkReportMessage(report());
  assert.match(msg, /За день новых нарушений и апелляций нет\./);
});

test("special characters in a name do not break the layout", () => {
  const msg = buildMargaritaWorkReportMessage(
    report({
      violationsCreated: 1,
      byAccountant: [
        {
          name: "Աни <О'Брайен> & Co. _*[x]",
          chatsChecked: 0,
          evaluations: 0,
          violations: 1,
          acknowledgements: 0,
          appealsSubmitted: 0,
          approved: 0,
          rejected: 0,
          pending: 0,
          unprocessed: 1,
        },
      ],
    })
  );
  // Name is preserved verbatim (plain text) and stays on its own single line.
  const nameLines = msg.split("\n").filter((l) => l.includes("О'Брайен"));
  assert.equal(nameLines.length, 1);
  assert.equal(nameLines[0], "Աни <О'Брайен> & Co. _*[x]");
});
