import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectAllSignals, deriveStatus } from "../src/lib/mailings-detect.js";

describe("detectAllSignals — Russian", () => {
  it("main_taxes done: sent tax return", () => {
    const sigs = detectAllSignals("Налоговая декларация по НДС отправлена.");
    assert.ok(sigs.some((s) => s.category === "main_taxes" && s.type === "done"));
  });

  it("salary done: received payroll", () => {
    const sigs = detectAllSignals("Ведомость по зарплате получена от клиента.");
    assert.ok(sigs.some((s) => s.category === "salary" && s.type === "done"));
  });

  it("salary req: asked for salary docs", () => {
    const sigs = detectAllSignals("Прошу прислать ведомость по зп за месяц.");
    assert.ok(sigs.some((s) => s.category === "salary" && s.type === "req"));
  });

  it("primary_docs done: received primary docs", () => {
    const sigs = detectAllSignals("Первичные документы получены от клиента.");
    assert.ok(sigs.some((s) => s.category === "primary_docs" && s.type === "done"));
  });

  it("primary_docs req: requested acts", () => {
    const sigs = detectAllSignals("Прошу прислать акты за прошлый месяц.");
    assert.ok(sigs.some((s) => s.category === "primary_docs" && s.type === "req"));
  });

  it("debts paid: debt closed", () => {
    const sigs = detectAllSignals("Долг оплатил, задолженность закрыта.");
    assert.ok(sigs.some((s) => s.category === "debts" && s.type === "paid"));
  });

  it("debts call: called about debt", () => {
    const sigs = detectAllSignals("Позвонил клиенту по поводу долга.");
    assert.ok(sigs.some((s) => s.category === "debts" && s.type === "call"));
  });

  it("debts req: wrote about debt", () => {
    const sigs = detectAllSignals("Написал клиенту напоминание о задолженности.");
    assert.ok(sigs.some((s) => s.category === "debts" && s.type === "req"));
  });

  it("no signal for unrelated text", () => {
    const sigs = detectAllSignals("Добрый день, как дела?");
    assert.deepEqual(sigs, []);
  });

  it("no signal for very short text", () => {
    assert.deepEqual(detectAllSignals("ок"), []);
    assert.deepEqual(detectAllSignals(""), []);
  });
});

describe("detectAllSignals — Armenian", () => {
  it("main_taxes done: Armenian tax sent", () => {
    const sigs = detectAllSignals("ԱԱՀ-ի հայտը ներկայացվել է։");
    assert.ok(sigs.some((s) => s.category === "main_taxes" && s.type === "done"));
  });

  it("debts req: Armenian debt reminder", () => {
    const sigs = detectAllSignals("Պարտքի մասին գրել ենք հաճախորդին։");
    assert.ok(sigs.some((s) => s.category === "debts" && s.type === "req"));
  });

  it("debts paid: Armenian debt cleared", () => {
    const sigs = detectAllSignals("Պարտքը վճարված է, փակված է։");
    assert.ok(sigs.some((s) => s.category === "debts" && s.type === "paid"));
  });
});

describe("detectAllSignals — deduplication", () => {
  it("duplicate (category, type) from two rules fires only once", () => {
    // A message matching both an Armenian and a Russian salary/done rule
    const sigs = detectAllSignals(
      "Ведомость по зарплате получена. Աշխատավարձի ստ․ կատ․"
    );
    const salaryDone = sigs.filter((s) => s.category === "salary" && s.type === "done");
    assert.equal(salaryDone.length, 1);
  });
});

describe("deriveStatus", () => {
  it("main_taxes: done≥1 → Отправил", () => {
    assert.equal(deriveStatus("main_taxes", { done: 1, req: 0, call: 0, paid: 0 }), "Отправил");
    assert.equal(deriveStatus("main_taxes", { done: 0, req: 3, call: 0, paid: 0 }), null);
  });

  it("salary: graduated correctly", () => {
    assert.equal(deriveStatus("salary", { done: 1, req: 0, call: 0, paid: 0 }), "Получил");
    assert.equal(deriveStatus("salary", { done: 0, req: 2, call: 0, paid: 0 }), "Запросил 2, не получил");
    assert.equal(deriveStatus("salary", { done: 0, req: 1, call: 0, paid: 0 }), "Запросил 1, не получил");
    assert.equal(deriveStatus("salary", { done: 0, req: 0, call: 0, paid: 0 }), null);
  });

  it("primary_docs: graduated correctly", () => {
    assert.equal(deriveStatus("primary_docs", { done: 1, req: 5, call: 0, paid: 0 }), "Получил");
    assert.equal(deriveStatus("primary_docs", { done: 0, req: 3, call: 0, paid: 0 }), "Запросил 2, не получил");
    assert.equal(deriveStatus("primary_docs", { done: 0, req: 1, call: 0, paid: 0 }), "Запросил 1, не получил");
  });

  it("debts: graduated correctly", () => {
    assert.equal(deriveStatus("debts", { done: 0, req: 0, call: 0, paid: 1 }), "Нет долга");
    assert.equal(deriveStatus("debts", { done: 0, req: 0, call: 1, paid: 0 }), "1-й позвонил");
    assert.equal(deriveStatus("debts", { done: 0, req: 2, call: 0, paid: 0 }), "2-й написал");
    assert.equal(deriveStatus("debts", { done: 0, req: 1, call: 0, paid: 0 }), "1-й написал");
    assert.equal(deriveStatus("debts", { done: 0, req: 0, call: 0, paid: 0 }), null);
  });

  it("done wins over req for salary (done takes priority)", () => {
    assert.equal(deriveStatus("salary", { done: 1, req: 2, call: 0, paid: 0 }), "Получил");
  });

  it("paid wins over call and req for debts", () => {
    assert.equal(deriveStatus("debts", { done: 0, req: 3, call: 2, paid: 1 }), "Нет долга");
  });

  it("unknown category → null", () => {
    assert.equal(deriveStatus("unknown_cat", { done: 5, req: 5, call: 5, paid: 5 }), null);
  });
});

describe("detectAllSignals — акт false-positive guard", () => {
  it("'Актив' company name does NOT fire primary_docs", () => {
    const sigs = detectAllSignals("ООО Актив передало данные за квартал.");
    assert.ok(!sigs.some((s) => s.category === "primary_docs"), "Актив must not match акт");
  });

  it("standalone акт still fires primary_docs/done", () => {
    const sigs = detectAllSignals("Акт выполненных работ получен от клиента.");
    assert.ok(sigs.some((s) => s.category === "primary_docs" && s.type === "done"));
  });

  it("акты plural fires primary_docs/done", () => {
    const sigs = detectAllSignals("Акты за квартал получены от клиента.");
    assert.ok(sigs.some((s) => s.category === "primary_docs" && s.type === "done"));
  });

  it("акты plural fires primary_docs/req", () => {
    const sigs = detectAllSignals("Прошу прислать акты за прошлый период.");
    assert.ok(sigs.some((s) => s.category === "primary_docs" && s.type === "req"));
  });
});

describe("detectAllSignals — Armenian req excludes done-action words", () => {
  it("salary/done fires on Armenian sent word; salary/req does NOT", () => {
    const sigs = detectAllSignals("աշխատավարձ ուղարկ.");
    assert.ok(sigs.some((s) => s.category === "salary" && s.type === "done"));
    assert.ok(!sigs.some((s) => s.category === "salary" && s.type === "req"));
  });

  it("salary/done fires on Armenian provide word; salary/req does NOT", () => {
    const sigs = detectAllSignals("աշխատավարձ տրամ.");
    assert.ok(sigs.some((s) => s.category === "salary" && s.type === "done"));
    assert.ok(!sigs.some((s) => s.category === "salary" && s.type === "req"));
  });

  it("primary_docs/done fires on Armenian sent word; primary_docs/req does NOT", () => {
    const sigs = detectAllSignals("փաստաթ ուղարկ.");
    assert.ok(sigs.some((s) => s.category === "primary_docs" && s.type === "done"));
    assert.ok(!sigs.some((s) => s.category === "primary_docs" && s.type === "req"));
  });

  it("salary/req still fires with a genuine Armenian request word", () => {
    const sigs = detectAllSignals("աշխատավարձ խնդրե.");
    assert.ok(sigs.some((s) => s.category === "salary" && s.type === "req"));
  });
});

describe("detectAllSignals — expanded verb coverage", () => {
  it("main_taxes done: 'подал декларацию' (подал, not covered by подан)", () => {
    const sigs = detectAllSignals("Подал декларацию по налогу на прибыль.");
    assert.ok(sigs.some((s) => s.category === "main_taxes" && s.type === "done"));
  });

  it("main_taxes done: 'отчитался по налогам'", () => {
    const sigs = detectAllSignals("Отчитался по налогам за квартал.");
    assert.ok(sigs.some((s) => s.category === "main_taxes" && s.type === "done"));
  });

  it("salary done: 'выслал ведомость клиенту'", () => {
    const sigs = detectAllSignals("Выслал ведомость по зарплате клиенту.");
    assert.ok(sigs.some((s) => s.category === "salary" && s.type === "done"));
  });

  it("salary req: 'жду ведомость от клиента' still req, not done", () => {
    const sigs = detectAllSignals("Жду ведомость по зарплате от клиента.");
    assert.ok(sigs.some((s) => s.category === "salary" && s.type === "req"));
    assert.ok(!sigs.some((s) => s.category === "salary" && s.type === "done"));
  });

  it("primary_docs done: 'переслал документы бухгалтеру'", () => {
    const sigs = detectAllSignals("Переслал первичные документы бухгалтеру.");
    assert.ok(sigs.some((s) => s.category === "primary_docs" && s.type === "done"));
  });

  it("'отправьте документы' (imperative request) fires req, NOT done", () => {
    const sigs = detectAllSignals("Отправьте, пожалуйста, первичные документы.");
    assert.ok(sigs.some((s) => s.category === "primary_docs" && s.type === "req"));
    assert.ok(!sigs.some((s) => s.category === "primary_docs" && s.type === "done"));
  });

  it("'отправьте ведомость' (imperative request) fires salary req, NOT done", () => {
    const sigs = detectAllSignals("Отправьте ведомость по зарплате, пожалуйста.");
    assert.ok(sigs.some((s) => s.category === "salary" && s.type === "req"));
    assert.ok(!sigs.some((s) => s.category === "salary" && s.type === "done"));
  });

  it("debts paid: passive 'долг оплачен'", () => {
    const sigs = detectAllSignals("Долг оплачен полностью.");
    assert.ok(sigs.some((s) => s.category === "debts" && s.type === "paid"));
  });

  it("debts paid: 'задолженность выплатила'", () => {
    const sigs = detectAllSignals("Клиентка задолженность выплатила.");
    assert.ok(sigs.some((s) => s.category === "debts" && s.type === "paid"));
  });

  it("debts call: 'созвонились по долгу'", () => {
    const sigs = detectAllSignals("Созвонились с клиентом по долгу.");
    assert.ok(sigs.some((s) => s.category === "debts" && s.type === "call"));
  });
});

describe("deriveStatus — additional edge cases", () => {
  it("debts: call takes priority over req>=2", () => {
    assert.equal(deriveStatus("debts", { done: 0, req: 2, call: 1, paid: 0 }), "1-й позвонил");
  });

  it("salary: req>2 still returns Запросил 2, не получил", () => {
    assert.equal(deriveStatus("salary", { done: 0, req: 5, call: 0, paid: 0 }), "Запросил 2, не получил");
  });

  it("main_taxes: only done triggers a status; req/call/paid alone return null", () => {
    assert.equal(deriveStatus("main_taxes", { done: 0, req: 5, call: 3, paid: 2 }), null);
  });
});
