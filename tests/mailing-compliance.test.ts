import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildMailingCompliance,
  type ComplianceChatInput,
  type ComplianceMailingInput,
} from "../src/lib/mailing-compliance.js";
import { buildMailingComplianceMessage } from "../src/lib/templates.js";

const chats: ComplianceChatInput[] = [
  { agr_no: "B-1", accountant: "Гаяне", status: "Active", client: "ABC" },
  { agr_no: "B-2", accountant: "Гаяне", status: "Active", client: "DEF" },
  { agr_no: "B-3", accountant: "Гаяне", status: "Active", client: "GHI" },
  { agr_no: "B-4", accountant: "Лилит", status: "Active", client: "JKL" },
  { agr_no: "B-5", accountant: "Гаяне", status: "Inactive", client: "OLD" }, // excluded
];

const mailings: ComplianceMailingInput[] = [
  // primary_docs
  { agr_no: "B-1", category: "primary_docs", status: "Получил", source: "telegram", detected_at: "2026-07-05" },
  { agr_no: "B-2", category: "primary_docs", status: "Получил", source: "telegram", detected_at: "2026-07-05" },
  { agr_no: "B-3", category: "primary_docs", status: "Не запросил 1", source: "telegram", detected_at: "2026-07-05" },
  // salary — B-1 has BOTH telegram + manual; manual must win
  { agr_no: "B-1", category: "salary", status: "Не запросил 1", source: "telegram", detected_at: "2026-07-01" },
  { agr_no: "B-1", category: "salary", status: "Получил", source: "manual", confirmed: true, confirmed_at: "2026-07-06" },
  // taxes
  { agr_no: "B-2", category: "main_taxes", status: "Отправил", source: "telegram", detected_at: "2026-07-05" },
  // inactive chat mailing — must be excluded
  { agr_no: "B-5", category: "primary_docs", status: "Получил", source: "telegram", detected_at: "2026-07-05" },
  // Лилит debts
  { agr_no: "B-4", category: "debts", status: "Нет долга", source: "manual", confirmed: true, confirmed_at: "2026-07-03" },
];

describe("mailing-compliance report (файл-2)", () => {
  const report = buildMailingCompliance(chats, mailings, "202607", { roster: ["Гаяне", "Лилит"] });
  const gayane = report.perAccountant.find((a) => a.accountant === "Гаяне")!;

  it("groups by accountant and counts UNIQUE chats per status", () => {
    const primary = gayane.categories.find((c) => c.category === "primary_docs")!;
    const poluchil = primary.statuses.find((s) => s.status === "Получил")!;
    assert.equal(poluchil.count, 2); // B-1, B-2
    assert.equal(primary.statuses.find((s) => s.status === "Не запросил 1")!.count, 1); // B-3
  });

  it("Margarita's manual status overrides the automatic one", () => {
    const salary = gayane.categories.find((c) => c.category === "salary")!;
    // B-1 telegram said «Не запросил 1» but manual «Получил» wins → one chat, status Получил.
    assert.equal(salary.statuses.find((s) => s.status === "Получил")?.count, 1);
    assert.ok(!salary.statuses.some((s) => s.status === "Не запросил 1"));
  });

  it("inactive chats are excluded", () => {
    const primary = gayane.categories.find((c) => c.category === "primary_docs")!;
    const total = primary.statuses.reduce((s, x) => s + x.count, 0);
    assert.equal(total, 3); // B-1, B-2, B-3 — NOT the inactive B-5
    assert.ok(!primary.statuses.some((s) => s.chats.some((c) => c.agr_no === "B-5")));
  });

  it("sum of statuses never exceeds applicable chats; one chat once per category", () => {
    for (const acc of report.perAccountant) {
      for (const cat of acc.categories) {
        const sum = cat.statuses.reduce((s, x) => s + x.count, 0);
        assert.equal(sum, cat.applicable);
        const ids = cat.statuses.flatMap((s) => s.chats.map((c) => c.agr_no));
        assert.equal(new Set(ids).size, ids.length, "a chat appears at most once per category");
      }
    }
  });

  it("one chat CAN appear in different categories (separate workflows)", () => {
    const primary = gayane.categories.find((c) => c.category === "primary_docs")!;
    const salary = gayane.categories.find((c) => c.category === "salary")!;
    const inPrimary = primary.statuses.flatMap((s) => s.chats.map((c) => c.agr_no)).includes("B-1");
    const inSalary = salary.statuses.flatMap((s) => s.chats.map((c) => c.agr_no)).includes("B-1");
    assert.ok(inPrimary && inSalary, "B-1 appears in both primary_docs and salary");
  });

  it("drill-down: each status carries the exact chats behind the count", () => {
    const primary = gayane.categories.find((c) => c.category === "primary_docs")!;
    const poluchil = primary.statuses.find((s) => s.status === "Получил")!;
    assert.deepEqual(poluchil.chats.map((c) => c.agr_no).sort(), ["B-1", "B-2"]);
    assert.ok(poluchil.chats.every((c) => c.client && c.contract));
  });

  it("message hides zero statuses & empty accountants, shows period and headers", () => {
    const msg = buildMailingComplianceMessage(report, { periodLabel: "07.2026" });
    assert.match(msg, /Период: 07\.2026/);
    assert.match(msg, /Гаяне/);
    assert.match(msg, /До 28 — Первичная документация/);
    assert.match(msg, /Получил — 2/);
    assert.match(msg, /До 15 — Основные налоги\nОтправил — 1/);
    // Лилит only has debts.
    assert.match(msg, /Лилит\nДолги до 5\nНет долга — 1/);
  });
});
