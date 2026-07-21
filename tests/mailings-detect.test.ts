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

  it("salary done: рассылка по зарплате sent → done (even if 'no salary')", () => {
    const sigs = detectAllSignals(
      "Разослал рассылку по зарплате: в этом периоде зарплата не начислялась."
    );
    assert.ok(sigs.some((s) => s.category === "salary" && s.type === "done"));
    // done wins over the negation → «Получил».
    const counts = { done: 1, req: 0, call: 0, paid: 0, neg: 1 };
    assert.equal(deriveStatus("salary", counts), "Получил");
  });

  it("salary done (HY): «Տեղեկացնում ենք … աշխատավարձ … չի կատարվում» = sent", () => {
    const sigs = detectAllSignals(
      "Տեղեկացնում ենք, որ ընթացիկ ժամանակահատվածի համար աշխատավարձի հաշվարկ չի կատարվում։"
    );
    assert.ok(sigs.some((s) => s.category === "salary" && s.type === "done"));
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

describe("detectAllSignals — punctuation / case / ЗП variants", () => {
  const positives = [
    "Зарплата — Получил",
    "Зарплата - получил",
    "Зарплата получил",
    "Зарплата: получил",
    "ЗП получил",
    "Зарплата — отправлено",
    "Зарплата — сделано",
    "ЗАРПЛАТА ПОЛУЧИЛ",
  ];
  for (const text of positives) {
    it(`salary/done fires for «${text}»`, () => {
      const sigs = detectAllSignals(text);
      assert.ok(
        sigs.some((s) => s.category === "salary" && s.type === "done"),
        `expected salary/done for «${text}»`
      );
      assert.ok(
        !sigs.some((s) => s.category === "salary" && s.type === "neg"),
        `must NOT be neg for «${text}»`
      );
    });
  }
});

describe("detectAllSignals — negation must NOT count as completed", () => {
  const negatives = [
    "Зарплата — не получил",
    "Зарплата - не получил",
    "Зарплата не получила",
    "Зарплата — не отправлено",
    "ЗП не сделано",
    "Ведомость по зарплате пока не получили",
  ];
  for (const text of negatives) {
    it(`salary NOT done, marked neg for «${text}»`, () => {
      const sigs = detectAllSignals(text);
      assert.ok(
        !sigs.some((s) => s.category === "salary" && s.type === "done"),
        `must NOT be done for «${text}»`
      );
      assert.ok(
        sigs.some((s) => s.category === "salary" && s.type === "neg"),
        `expected salary/neg for «${text}»`
      );
    });
  }

  it("negated salary derives a not-completed status, never «Получил»", () => {
    assert.equal(deriveStatus("salary", { done: 0, req: 0, call: 0, paid: 0, neg: 1 }), "Запросил 1, не получил");
  });

  it("negated taxes derive «Не отправил»", () => {
    const sigs = detectAllSignals("Налоги за месяц не отправлены.");
    assert.ok(sigs.some((s) => s.category === "main_taxes" && s.type === "neg"));
    assert.ok(!sigs.some((s) => s.category === "main_taxes" && s.type === "done"));
    assert.equal(deriveStatus("main_taxes", { done: 0, req: 0, call: 0, paid: 0, neg: 1 }), "Не отправил");
  });

  it("a later real completion still wins over an earlier negative", () => {
    assert.equal(deriveStatus("salary", { done: 1, req: 0, call: 0, paid: 0, neg: 1 }), "Получил");
  });

  it("primary_docs negation: «документы не прислали» is not done", () => {
    const sigs = detectAllSignals("Первичные документы клиент не прислал.");
    assert.ok(sigs.some((s) => s.category === "primary_docs" && s.type === "neg"));
    assert.ok(!sigs.some((s) => s.category === "primary_docs" && s.type === "done"));
  });

  it("debts negation: «долг не оплачен» is not «Нет долга»", () => {
    const sigs = detectAllSignals("Долг клиент так и не оплатил.");
    assert.ok(!sigs.some((s) => s.category === "debts" && s.type === "paid"));
  });

  it("Armenian negation: «աշխատավարձ ... չի կատարվում» is not done", () => {
    const sigs = detectAllSignals(
      "Աշխատավարձի հաշվարկը չի կատարվում ընկերությունում աշխատակիցների բացակայության պատճառով"
    );
    assert.ok(!sigs.some((s) => s.category === "salary" && s.type === "done"));
    assert.ok(sigs.some((s) => s.category === "salary" && s.type === "neg"));
  });
});

describe("detectAllSignals — «сделано» completion synonyms", () => {
  it("salary done: «Зарплата сделано»", () => {
    const sigs = detectAllSignals("Зарплата сделано за месяц.");
    assert.ok(sigs.some((s) => s.category === "salary" && s.type === "done"));
  });
  it("primary_docs done: «Первичка готова»", () => {
    const sigs = detectAllSignals("Первичка готова, всё оформлено.");
    assert.ok(sigs.some((s) => s.category === "primary_docs" && s.type === "done"));
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

// ---------------------------------------------------------------------------
// v8 acceptance corpus — scoped negation of the SENDING verb.
// Reduce a single message to its final per-category status the same way the
// runner does (count that message's signals, then deriveStatus).
// ---------------------------------------------------------------------------
function statusOf(category: string, text: string): string | null {
  const counts = { done: 0, req: 0, call: 0, paid: 0, neg: 0 };
  for (const s of detectAllSignals(text)) {
    if (s.category === category) counts[s.type] += 1;
  }
  return deriveStatus(category, counts);
}

describe("v8 corpus — salary рассылка should resolve to «Получил»", () => {
  const done = [
    "Разослал рассылку по зарплате: в этом периоде зарплата не начислялась.",
    "Уведомили клиента по зарплате за март.",
    "Зарплатную ведомость получил, спасибо.",
    "Отправила рассылку по зп.",
    "Տեղեկացնում ենք, որ ընթացիկ ժամանակահատվածի համար աշխատավարձի հաշվարկ չի կատարվում։",
    // mixed: an UNRELATED negation about documents must NOT suppress the send.
    "Рассылку по зарплате отправила, документы ещё не получила.",
  ];
  for (const text of done) {
    it(`«${text}» → Получил`, () => {
      assert.ok(
        detectAllSignals(text).some((s) => s.category === "salary" && s.type === "done"),
        `expected salary/done for «${text}»`
      );
      assert.equal(statusOf("salary", text), "Получил", `expected «Получил» for «${text}»`);
    });
  }
});

describe("v8 corpus — salary must NOT resolve to «Получил»", () => {
  const notDone: Array<[string, string | null]> = [
    // negated SEND → not done (falls through to req/neg → «Запросил 1…»).
    ["Рассылку по зарплате ещё не отправила.", "Запросил 1, не получил"],
    ["Рассылка по зп не сделана.", "Запросил 1, не получил"],
    ["Не разослал уведомление по зарплате.", "Запросил 1, не получил"],
    // «сообщите …» imperative is a REQUEST, never a sent notification.
    ["Сообщите, пожалуйста, зарплату за месяц.", "Запросил 1, не получил"],
    ["Жду ведомость по зарплате от клиента.", "Запросил 1, не получил"],
  ];
  for (const [text, expected] of notDone) {
    it(`«${text}» → not «Получил» (${expected})`, () => {
      assert.ok(
        !detectAllSignals(text).some((s) => s.category === "salary" && s.type === "done"),
        `must NOT be salary/done for «${text}»`
      );
      const status = statusOf("salary", text);
      assert.notEqual(status, "Получил", `must NOT be «Получил» for «${text}»`);
      assert.equal(status, expected, `expected «${expected}» for «${text}»`);
    });
  }
});

describe("v8 — scoped negation preserves the legit «no salary this period» template", () => {
  it("RU «зарплата не начисляется» stays done (calc negated, send not)", () => {
    const text = "Разослали рассылку: зарплата в этом периоде не начисляется.";
    assert.equal(statusOf("salary", text), "Получил");
  });

  it("HY «աշխատավարձի հաշվարկ չի կատարվում» stays done when the notification was sent", () => {
    const text =
      "Տեղեկացնում ենք, որ ընթացիկ ժամանակահատվածի համար աշխատավարձի հաշվարկ չի կատարվում։";
    assert.equal(statusOf("salary", text), "Получил");
  });

  it("HY negated SEND «չենք տեղեկացրել» is NOT done", () => {
    const text = "Աշխատավարձի մասին դեռ չենք տեղեկացրել։";
    assert.ok(
      !detectAllSignals(text).some((s) => s.category === "salary" && s.type === "done"),
      "negated Armenian send must not be salary/done"
    );
    assert.notEqual(statusOf("salary", text), "Получил");
  });
});

describe("v8 — scoped negation applied to main_taxes (unrelated neg must not suppress)", () => {
  it("«налоги отправила, зарплату не получила» → taxes still «Отправил»", () => {
    const text = "Налоги отправила, зарплату пока не получила.";
    assert.ok(
      detectAllSignals(text).some((s) => s.category === "main_taxes" && s.type === "done"),
      "taxes send must survive an unrelated receive-negation"
    );
    assert.ok(
      !detectAllSignals(text).some((s) => s.category === "main_taxes" && s.type === "neg"),
      "taxes must not be neg here"
    );
    assert.equal(statusOf("main_taxes", text), "Отправил");
  });

  it("«налоги не отправлены» is still «Не отправил» (genuine send negation)", () => {
    const text = "Налоги за месяц ещё не отправлены.";
    assert.equal(statusOf("main_taxes", text), "Не отправил");
  });
});

// ---------------------------------------------------------------------------
// v10 — broadened debt-reminder coverage + media-caption content.
// ---------------------------------------------------------------------------
import { messageContent } from "../src/lib/mailings-detect.js";

describe("detectAllSignals — debt-reminder mailing wording variants (v10)", () => {
  const reminders = [
    "Напоминаем о задолженности за услуги.",
    "Уведомляем клиента о наличии задолженности.",
    "Разослали напоминание по долгам за период.",
    "Просим оплатить задолженность до конца недели.",
    "Просьба погасить долг.",
    "Оплатите, пожалуйста, задолженность.",
    "Написали клиенту по поводу долга.",
    "Сообщаем о просроченной задолженности по договору.",
    "Информируем вас о задолженности.",
  ];
  for (const text of reminders) {
    it(`debts/req fires for «${text}»`, () => {
      const sigs = detectAllSignals(text);
      assert.ok(
        sigs.some((s) => s.category === "debts" && s.type === "req"),
        `expected debts/req for «${text}»`
      );
    });
  }

  it("graduated debt status from two reminders → «2-й написал»", () => {
    assert.equal(deriveStatus("debts", { done: 0, req: 2, call: 0, paid: 0 }), "2-й написал");
  });
});

describe("detectAllSignals — unrelated debt discussion is NOT a mailing", () => {
  it("a passing mention of debt with no contact/reminder verb does not fire req", () => {
    const sigs = detectAllSignals("У клиента большой долг перед поставщиком, это его проблема.");
    assert.ok(!sigs.some((s) => s.category === "debts" && s.type === "req"));
    assert.ok(!sigs.some((s) => s.category === "debts" && s.type === "paid"));
  });

  it("«долг не оплачен» stays not-paid (negation guard holds)", () => {
    const sigs = detectAllSignals("Долг до сих пор не оплачен клиентом.");
    assert.ok(!sigs.some((s) => s.category === "debts" && s.type === "paid"));
  });
});

describe("messageContent — media caption is scanned too", () => {
  it("combines body + caption", () => {
    assert.equal(messageContent({ text: "См. вложение", caption: "Напоминаем о задолженности" }),
      "См. вложение\nНапоминаем о задолженности");
    assert.equal(messageContent({ text: null, caption: "Долг оплачен" }), "Долг оплачен");
    assert.equal(messageContent({ text: "Привет", caption: null }), "Привет");
    assert.equal(messageContent({}), "");
  });

  it("a debt reminder that lives ONLY in the caption is detected", () => {
    const content = messageContent({ text: "", caption: "Напоминаем об оплате задолженности." });
    assert.ok(detectAllSignals(content).some((s) => s.category === "debts" && s.type === "req"));
  });
});

describe("detection is deterministic (idempotent re-sync yields identical signals)", () => {
  it("same message → same signals every call", () => {
    const text = "Напоминаем о задолженности, просим оплатить.";
    assert.deepEqual(detectAllSignals(text), detectAllSignals(text));
  });
});

// ---------------------------------------------------------------------------
// v11 — standard department mailing templates (Маргарита: рассылка по оплате
// услуг/долгам + ЗП/документы часто не подтягивались автоматически).
// ---------------------------------------------------------------------------
describe("v11 — service-payment reminder (оплата услуг, до 5 числа) → debts", () => {
  const svcPayReminders = [
    "Оплатите бухгалтерские услуги до 5 числа — мы учтем их в расходах текущего периода и снизим налоговую нагрузку.",
    "Напоминаем о необходимости произвести оплату для продолжения работы. Реквизиты: р/с 1930097970708600, банк Converse Bank, назначение: payment for accountant service.",
    "Для соблюдения сроков просим оплатить услуги до 5 числа. Отчетность сдается только после оплаты услуг.",
  ];
  for (const text of svcPayReminders) {
    it(`debts/req fires for service-payment reminder «${text.slice(0, 40)}…»`, () => {
      assert.ok(
        detectAllSignals(text).some((s) => s.category === "debts" && s.type === "req"),
        `expected debts/req for «${text}»`
      );
    });
    it(`service-payment reminder is NOT falsely counted as taxes sent «${text.slice(0, 40)}…»`, () => {
      assert.notEqual(
        statusOf("main_taxes", text),
        "Отправил",
        "payment-for-services reminder must not be classified as a tax mailing"
      );
    });
  }

  it("bank purpose line «payment for accountant service» alone fires debts/req", () => {
    assert.equal(statusOf("debts", "payment for accountant service"), "1-й написал");
  });

  it("a genuine tax mailing with реквизиты is still «Отправил» (guard doesn't over-suppress)", () => {
    const text = "Налоги за период необходимо оплатить на расчётные счета. Реквизиты во вложении.";
    assert.equal(statusOf("main_taxes", text), "Отправил");
  });

  it("welcome template field «Срок оплаты услуг:» is NOT a debts reminder", () => {
    const text =
      "Здравствуйте! Меня зовут Анна, я ваш ведущий бухгалтер. Налоговая система: УСН. Срок оплаты услуг: до 5 числа. Спасибо вам за доверие и выбор бухгалтерского обслуживания.";
    assert.ok(!detectAllSignals(text).some((s) => s.category === "debts" && s.type === "req"));
  });
});

describe("v11 — salary send templates (до 10 числа) → «Получил»", () => {
  const salaryDone = [
    "Направляю таблицу по заработным платам, также сообщаю, что оплаты проставлены в банке.",
    "Перечислил заработную плату сотрудникам за период.",
    "Выплаты заработной платы произведены.",
    "Сообщаем, что начисление заработной платы за текущий период не производится в связи с отсутствием сотрудников в компании.",
  ];
  for (const text of salaryDone) {
    it(`salary «Получил» for «${text.slice(0, 40)}…»`, () => {
      assert.equal(statusOf("salary", text), "Получил", `expected «Получил» for «${text}»`);
    });
  }

  it("«зарплату не перечислил» stays not-done (negation guard holds)", () => {
    assert.notEqual(statusOf("salary", "Зарплату за месяц ещё не перечислил."), "Получил");
  });
});

describe("v11 — document request template (до 28 числа) → req", () => {
  const docsRequest =
    "Просим вас предоставить следующую информацию за июль: информация по выставляемым счетам (инвойс, акт, счет-фактура), банковская выписка, данные для расчета заработной платы.";
  it("primary_docs/req fires for «Просим предоставить … инвойс, акт»", () => {
    assert.ok(detectAllSignals(docsRequest).some((s) => s.category === "primary_docs" && s.type === "req"));
  });
  it("salary/req fires for «данные для расчета заработной платы»", () => {
    assert.ok(detectAllSignals(docsRequest).some((s) => s.category === "salary" && s.type === "req"));
  });
});

describe("v11 — report-submitted template (до 15 числа) → taxes «Отправил»", () => {
  it("«Отчет подготовлен и сдан … Налоги выставлены в банке»", () => {
    const text =
      "Отчет подготовлен и сдан. Следующим сообщением направляю расчет налогов. Налоги выставлены в банке, прошу зайти и подтвердить оплаты.";
    assert.equal(statusOf("main_taxes", text), "Отправил");
  });
});

// ---------------------------------------------------------------------------
// v12 — SOFT catch-all: a category keyword + a generic mailing/notification word
// is enough to identify the рассылка, so no type is ever missed for lack of a
// specific action verb. Every one of the four types is guaranteed a detection.
// ---------------------------------------------------------------------------
describe("v12 — soft catch-all identifies every рассылка type", () => {
  const cases: Array<[string, string, string | null]> = [
    // [message, category, expected status]
    ["Информационное письмо по налогам за период.", "main_taxes", "Отправил"],
    ["Оповещаем вас об изменении сумм налога.", "main_taxes", "Отправил"],
    ["Рассылка по зарплате за месяц.", "salary", "Получил"],
    ["Извещаем о начислении заработной платы.", "salary", "Получил"],
    ["Напоминание по первичным документам за июль.", "primary_docs", "Запросил 1, не получил"],
    ["Рассылка по документам: ждём накладные.", "primary_docs", "Запросил 1, не получил"],
    ["Оповещаем о задолженности по договору.", "debts", "1-й написал"],
    ["Информируем о недоимке по налогам.", "debts", "1-й написал"],
  ];
  for (const [text, category, expected] of cases) {
    it(`«${text}» → ${category} ${expected}`, () => {
      assert.ok(
        detectAllSignals(text).some((s) => s.category === category),
        `expected a ${category} signal for «${text}»`
      );
      assert.equal(statusOf(category, text), expected, `expected «${expected}» for «${text}»`);
    });
  }

  it("Armenian mailing word identifies the type (documents → req)", () => {
    const sigs = detectAllSignals("Հիշեցնում ենք փաստաթղթերի մասին։");
    assert.ok(sigs.some((s) => s.category === "primary_docs" && s.type === "req"));
  });

  it("Armenian tax notification → taxes done", () => {
    assert.equal(statusOf("main_taxes", "Տեղեկացնում ենք հարկերի մասին։"), "Отправил");
  });

  it("English mailing word identifies the type (debt reminder → req)", () => {
    assert.equal(statusOf("debts", "This is a reminder about your outstanding debt."), "1-й написал");
  });

  it("soft catch-all still respects negation: «рассылку по налогам не отправил» is not done", () => {
    assert.notEqual(statusOf("main_taxes", "Рассылку по налогам ещё не отправил."), "Отправил");
  });

  it("soft catch-all does NOT fire without a category keyword", () => {
    assert.deepEqual(detectAllSignals("Разослали общее уведомление всем клиентам."), []);
  });

  it("welcome template with a category word but no mailing action is still not a completed рассылка", () => {
    // «Даты оплаты налогов: …» inside onboarding — no mailing verb → no taxes done here.
    const sigs = detectAllSignals("Налоговая система: УСН. Даты оплаты налогов: 20-го числа.");
    assert.ok(!sigs.some((s) => s.category === "main_taxes" && s.type === "done"));
  });
});
