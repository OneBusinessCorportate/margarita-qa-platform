import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectAllSignals, deriveStatus, isOnboardingMessage } from "../src/lib/mailings-detect.js";
import {
  classifyMessage,
  buildLearnedFingerprints,
  contentTokens,
  type ConfirmedExample,
} from "../src/lib/mailings-classify.js";

// Reduce a single message to a per-category status (as the runner does).
function statusOf(category: string, text: string): string | null {
  const counts = { done: 0, req: 0, call: 0, paid: 0, neg: 0 };
  for (const s of detectAllSignals(text)) if (s.category === category) counts[s.type] += 1;
  return deriveStatus(category, counts);
}
const has = (r: ReturnType<typeof classifyMessage>, cat: string) =>
  r.categories.find((c) => c.category === cat);

// --- Real spec examples ------------------------------------------------------

const ONBOARDING = `Здравствуйте! Спасибо вам за доверие и выбор OneBusiness для бухгалтерского обслуживания. Мы начинаем работу 💼 Меня зовут Лилит, я ваш ведущий бухгалтер.
Для удобства фиксирую ключевую информацию:
Налоговая система: УСН
Вид деятельности: IT
Сумма обслуживания: 20,000 драм
Срок оплаты услуг: 14-ое число каждого месяца
Даты оплаты налогов: Ежемесячные — 20-го числа каждого месяца, квартальные — 20-го числа после окончания квартала.`;

const RU_TAXES = `Налоги по состоянию на 09.07.2026 г.:
Налог с оборота — 33082 + 47680 драмов 900008000490
Налог на прибыль 2025 год — 63 600 драмов 900008000490
Социальный платеж — 5100 драмов 900008000490
Подоходный налог — 161 100 + 20400 драмов 900008000490
Гербовый сбор — 40 800 драмов 900005001186
Указанные налоги необходимо оплатить на соответствующие расчетные счета.`;

const HY_DOC_PAYROLL = `Բարև Ձեզ 😊 Հաշվետվությունների ժամանակին կազմման համար խնդրում ենք տրամադրել հետևյալ տեղեկատվությունը՝ նշելով հունիս ամիսը։
Տեղեկություն դուրս գրվող փաստաթղթերի վերաբերյալ՝ ինվոյս, կատարված աշխատանքների ակտ, հաշիվ-ֆակտուրա։
Ցանկացած փաստաթուղթ՝ կապված ներմուծման կամ արտահանման հետ, օրինակ՝ պայմանագիր, ինվոյս, CMR, մաքսային հայտարարագիր։
Աշխատավարձի հաշվարկի տվյալներ՝ ցանկալի է տրամադրել դրանց ճշգրտումից հետո։`;

describe("classifyMessage — spec examples", () => {
  it("Russian tax mailing → Налоги / Отправил (done)", () => {
    const r = classifyMessage(RU_TAXES, { date: "2026-07-09" });
    const tax = has(r, "main_taxes");
    assert.ok(tax, "main_taxes must be detected");
    assert.equal(tax!.status, "Отправил");
    assert.equal(tax!.type, "done");
    assert.equal(r.date, "2026-07-09");
    assert.ok(tax!.confidence >= 0.7);
    assert.equal(statusOf("main_taxes", RU_TAXES), "Отправил");
  });

  it("onboarding message mentions taxes but is NOT a completed tax mailing", () => {
    assert.equal(isOnboardingMessage(ONBOARDING), true);
    const r = classifyMessage(ONBOARDING, { date: "2026-07-01" });
    assert.equal(r.isOnboarding, true);
    const tax = has(r, "main_taxes");
    // Never «Отправил» from a welcome message.
    assert.ok(!tax || tax.status !== "Отправил", "onboarding must not be a sent tax mailing");
    assert.ok(!r.categories.some((c) => c.type === "done" || c.type === "paid"));
  });

  it("Armenian doc+payroll request → multiple categories (Первичка + Зарплата req)", () => {
    const r = classifyMessage(HY_DOC_PAYROLL, { date: "2026-06-30" });
    const primary = has(r, "primary_docs");
    const salary = has(r, "salary");
    assert.ok(primary, "primary_docs (первичка) must be detected");
    assert.ok(salary, "salary (зарплата) must be detected");
    assert.equal(primary!.type, "req");
    assert.equal(salary!.type, "req");
    // Not forced into a single category.
    assert.ok(r.categories.length >= 2);
  });

  it("Armenian primary-document request alone → primary_docs req", () => {
    const r = classifyMessage("Խնդրում ենք տրամադրել կատարված աշխատանքների ակտ և հաշիվ-ֆակտուրա։");
    assert.equal(has(r, "primary_docs")?.type, "req");
  });

  it("Armenian payroll request → salary req", () => {
    const r = classifyMessage("Խնդրում ենք տրամադրել աշխատավարձի հաշվարկի տվյալները հունիս ամսվա համար։");
    assert.equal(has(r, "salary")?.type, "req");
  });
});

// The exact standard department templates the owner uses (RU / EN / ZH), locked
// so «use those templates» detection can never silently regress.
describe("classifyMessage — owner's standard templates (multilingual)", () => {
  it("RU monthly info request → primary_docs + salary req", () => {
    const r = classifyMessage(
      `Для своевременной и корректной подготовки отчетности просим предоставить следующую информацию за Май месяц.
Информацию по выставляемым документам (инвойсы, акты, счета-фактуры).
Документы по импорту/экспорту (договор, инвойс, CMR, таможенная декларация).
Банковские выписки по всем счетам и во всех валютах.
Данные для расчета заработной платы.`
    );
    assert.equal(has(r, "primary_docs")?.type, "req");
    assert.equal(has(r, "salary")?.type, "req");
  });

  it("EN monthly info request → primary_docs + salary req", () => {
    const r = classifyMessage(
      `To ensure the timely and accurate preparation of your reports, please provide the following information for the month of June.
Information on issued documents (invoices, acts, tax invoices).
Import/export documents (contract, invoice, CMR, customs declaration, HS codes).
Bank statements for all accounts and currencies.
Payroll information.`
    );
    assert.equal(has(r, "primary_docs")?.type, "req");
    assert.equal(has(r, "salary")?.type, "req");
  });

  it("ZH monthly info request → primary_docs + salary req", () => {
    const r = classifyMessage(
      `为了确保报表及时、准确地编制，请提供 6 月份的以下信息：
关于开具发票的相关信息（Invoice、服务确认单、发票等）。
进出口相关文件（合同、Invoice、CMR、报关单、商品文件、HS编码）。
工资计算所需的数据。`
    );
    assert.equal(has(r, "primary_docs")?.type, "req");
    assert.equal(has(r, "salary")?.type, "req");
  });

  it("ZH service-payment reminder → debts req, never a tax mailing", () => {
    const r = classifyMessage(
      `请于每月5日前支付会计服务费用。付款用途：会计服务费。收款方：Business Tech LLC。金额：25,000 AMD。`
    );
    assert.equal(has(r, "debts")?.type, "req");
    assert.ok(!r.categories.some((c) => c.type === "done" || c.type === "paid"));
  });
});

describe("classifyMessage — English", () => {
  it("English payroll request → salary req", () => {
    const r = classifyMessage("Please provide the payroll data for June so we can prepare the report.");
    assert.equal(has(r, "salary")?.type, "req");
  });

  it("English document request → primary_docs req", () => {
    const r = classifyMessage("Kindly send the invoices and the act of completed work for last month.");
    assert.equal(has(r, "primary_docs")?.type, "req");
  });

  it("English tax filed → main_taxes done", () => {
    const r = classifyMessage("The VAT declaration has been submitted to the tax authority.");
    assert.equal(has(r, "main_taxes")?.status, "Отправил");
  });

  it("English debt reminder → debts req", () => {
    const r = classifyMessage("We sent a reminder to the client about the outstanding balance / debt.");
    assert.equal(has(r, "debts")?.type, "req");
  });

  it("English negation → not done", () => {
    const r = classifyMessage("The payroll data was not received from the client yet.");
    const salary = has(r, "salary");
    assert.ok(!salary || salary.status !== "Получил");
  });
});

describe("classifyMessage — mixed language & debt", () => {
  it("mixed RU/HY salary done fires once", () => {
    const r = classifyMessage("Ведомость по зарплате получена. Աշխատավարձի ստ․ կատ․");
    assert.equal(has(r, "salary")?.status, "Получил");
  });

  it("debt reminder (RU) → debts req", () => {
    const r = classifyMessage("Написал клиенту напоминание о задолженности за июнь.");
    assert.equal(has(r, "debts")?.type, "req");
  });

  it("debt cleared → Нет долга", () => {
    const r = classifyMessage("Долг оплачен, задолженность закрыта.");
    assert.equal(has(r, "debts")?.status, "Нет долга");
  });
});

describe("classifyMessage — false positives / low confidence", () => {
  it("unrelated small talk → no categories", () => {
    const r = classifyMessage("Добрый день! Как ваши дела сегодня?");
    assert.equal(r.categories.length, 0);
  });

  it("company name «Актив» does not trigger primary_docs", () => {
    const r = classifyMessage("ООО Актив передало данные за квартал.");
    assert.ok(!has(r, "primary_docs"));
  });

  it("a bare request has lower confidence than a completed action", () => {
    const req = classifyMessage("Прошу прислать акты за месяц.");
    const done = classifyMessage("Акты за месяц получены от клиента.");
    assert.ok(
      (has(req, "primary_docs")?.confidence ?? 1) <
        (has(done, "primary_docs")?.confidence ?? 0)
    );
  });
});

// --- Self-learning -----------------------------------------------------------

describe("self-learning fingerprints", () => {
  const salaryTemplates: ConfirmedExample[] = [
    { text: "Уведомляем по зарплате: данные направлены клиенту сегодня утром", category: "salary", status: "Получил", type: "done" },
    { text: "Уведомляем по зарплате: данные направлены клиенту после обеда", category: "salary", status: "Получил", type: "done" },
    { text: "Уведомляем по зарплате: данные направлены клиенту вечером", category: "salary", status: "Получил", type: "done" },
  ];

  it("builds a fingerprint only once ≥ minSupport examples back it", () => {
    const few = buildLearnedFingerprints(salaryTemplates.slice(0, 2), 3);
    assert.equal(few.length, 0, "2 examples < minSupport(3) → no learned rule");
    const enough = buildLearnedFingerprints(salaryTemplates, 3);
    assert.ok(enough.length >= 1, "3 examples → a learned fingerprint");
    assert.equal(enough[0].category, "salary");
    assert.equal(enough[0].status, "Получил");
    assert.ok(enough[0].tokens.length >= 2);
  });

  it("a confirmed fingerprint takes PRIORITY and marks source=confirmed", () => {
    const learned = buildLearnedFingerprints(salaryTemplates, 3);
    const r = classifyMessage(
      "Уведомляем по зарплате: данные направлены клиенту только что",
      { learned }
    );
    const salary = has(r, "salary");
    assert.ok(salary);
    assert.equal(salary!.status, "Получил");
    assert.equal(salary!.source, "confirmed");
    assert.ok(salary!.confidence >= 0.9);
  });

  it("Margarita's correction overrides the automatic prediction", () => {
    // Base rules would call this primary_docs/req; her confirmed corpus says it
    // is actually a debts reminder for this template family.
    const corrections: ConfirmedExample[] = [
      { text: "Клиент прислал документ но по долгу напомнили повторно вчера", category: "debts", status: "1-й написал", type: "req" },
      { text: "Клиент прислал документ но по долгу напомнили повторно утром", category: "debts", status: "1-й написал", type: "req" },
      { text: "Клиент прислал документ но по долгу напомнили повторно снова", category: "debts", status: "1-й написал", type: "req" },
    ];
    const learned = buildLearnedFingerprints(corrections, 3);
    const r = classifyMessage(
      "Клиент прислал документ но по долгу напомнили повторно ещё раз",
      { learned }
    );
    const debts = has(r, "debts");
    assert.ok(debts, "learned debts category should surface");
    assert.equal(debts!.source, "confirmed");
  });

  it("one accidental correction does NOT generalize (safeguard)", () => {
    const single: ConfirmedExample[] = [
      { text: "случайная одноразовая правка про налоги отправлено", category: "main_taxes", status: "Отправил", type: "done" },
    ];
    const learned = buildLearnedFingerprints(single, 3);
    assert.equal(learned.length, 0);
  });

  it("onboarding cannot be overridden into a completed mailing by a learned rule", () => {
    const learned = [
      { category: "main_taxes" as const, status: "Отправил", type: "done" as const, tokens: ["налогов", "система", "обслуживани"], support: 5 },
    ];
    const r = classifyMessage(ONBOARDING, { learned });
    const tax = has(r, "main_taxes");
    assert.ok(!tax || tax.status !== "Отправил", "onboarding stays not-completed even with a learned rule");
  });
});

describe("normalization", () => {
  it("contentTokens strips digits, punctuation, emoji and short/stop words", () => {
    const toks = contentTokens("Налоги 900008000490 отправлены! 💼 для вас");
    assert.ok(toks.includes("налоги"));
    assert.ok(toks.includes("отправлены"));
    assert.ok(!toks.includes("для"));
    assert.ok(!toks.some((t) => /\d/.test(t)));
  });
});
