// ---------------------------------------------------------------------------
// Keyword-based mailing detector for Russian + Armenian accountant messages.
//
// Each rule tags a message with a signal TYPE — the API route counts signals
// per (chat, category, type) across all messages in a period to derive the
// correct graduated status ("Запросил 2" after two requests, "2-й написал"
// after two debt follow-ups, etc.).
//
// NEGATION: phrases like «не получил», «не отправлено», «не сделано» (RU) or
// «չստացա», «չի կատարվում» (HY) describe an action that DID NOT happen. They
// must never be counted as `done`/`paid` (that was the old bug — «зарплата не
// получил» matched the `получ` stem and was marked «Получил»). Instead a
// negated completion suppresses the positive signal and emits a `neg` signal,
// which `deriveStatus` surfaces as a "not completed" status.
// ---------------------------------------------------------------------------

/**
 * Signal type tags — describe what the accountant did in the message:
 *   done  — completed the action (sent taxes, received docs, received salary)
 *   req   — made a request / wrote the client (asked for docs, wrote about debt)
 *   call  — made a phone call (called about debt)
 *   paid  — client paid the debt (no debt remaining)
 *   neg   — explicitly NOT done ("не получил", "не отправлено", "չի կատարվում")
 */
export type SignalType = "done" | "req" | "call" | "paid" | "neg";

export interface MailingSignal {
  category: "main_taxes" | "salary" | "primary_docs" | "debts";
  type: SignalType;
}

interface Rule {
  category: MailingSignal["category"];
  type: SignalType;
  /** All of these must match for the rule to fire. */
  all: RegExp[];
  /** If ANY of these match, the rule is suppressed (used for negation). */
  none?: RegExp[];
}

// --- Category keyword fragments (reused by positive + negation rules) --------
// \b is ASCII-only, so Cyrillic "зп" needs explicit non-letter lookarounds.
const KW = {
  taxes_ru: /(налог|декларац|ндс|налогов)/i,
  // «заработн» ловит штатный шаблон рассылки «начисление ЗАРАБОТНОЙ ПЛАТЫ за
  // текущий период не производится» — в нём нет подстроки «зарплат», поэтому
  // рассылка раньше не подхватывалась (Маргарита: ЗП не подтягивается сама).
  salary_ru: /(зарплат|зарплн|заработн|ведомост|(?<![а-яёА-ЯЁ])зп(?![а-яёА-ЯЁ])|авансовый\s+отчет|авансов)/i,
  primary_ru: /(первичн|первичк|(?<![а-яёА-ЯЁ])акт(?:ами|ах|ов|ом|ам|[ыауе])?(?![а-яёА-ЯЁ])|документ|накладн|счет-факт|счёт-факт)/i,
  // + «недоимк» (налоговая/страховая недоимка) — однозначно долговой термин,
  // расширяет распознавание рассылки по долгам без ложных срабатываний.
  debts_ru: /(долг|задолженност|задолж|недоимк)/i,
  // iu = Unicode case-fold so sentence-start capitals (Աշխատավարձ, Հարկ) match.
  taxes_hy: /(հարկ|ԱԱՀ|հայտ|հռչ|հաշվետ)/iu,
  salary_hy: /(աշխատավարձ|աշխ\.?\s*վ|ա\/վ|ա\.վ\.|հաշվ\.?\s*ց|ռոճիկ)/iu,
  // + ինվոյս (invoice), ֆակտուր (factura), CMR, մաքս (customs), ներմուծ/արտահանում
  // (import/export), պայմանագ (contract) — the multilingual doc-request template.
  primary_hy: /(փաստաթ|[աՈ][կք]տ|հաշիվ|[աՈ][կք]ներ|ն[եա]ր[կք]ա|ինվոյս|ֆակտուր|cmr|մաքս|ներմուծ|արտահան|պայմանագ)/iu,
  debts_hy: /(պարտք|պարտաբ)/iu,
  // --- English (ASCII, \b-safe; low collision with RU/HY) -------------------
  taxes_en: /\b(tax(?:es|ation)?|vat|tax\s+return|declaration)\b/i,
  salary_en: /\b(salary|salaries|payroll|wage|wages|pay\s?slip)\b/i,
  primary_en: /\b(primary\s+document|invoice|act\s+of\s+(?:completed|work)|acts?\s+of|contract|cmr|customs|waybill|consignment|shipping\s+document)\b/i,
  debts_en: /\b(debt|debts|overdue|outstanding\s+(?:balance|amount|payment)|payment\s+reminder|arrears)\b/i,
} as const;

// English completion / request verb fragments.
const DONE_SENT_EN = /\b(sent|submitted|filed|uploaded|declared|reported)\b/i;
const DONE_RECV_EN = /\b(received|got|provided|prepared|obtained|collected|signed)\b/i;
const REQ_EN = /\b(please\s+(?:provide|send|share|attach)|kindly\s+(?:provide|send)|we\s+(?:ask|need|request|kindly\s+ask)|request(?:ing)?|could\s+you\s+(?:please\s+)?(?:provide|send))\b/i;
const PAID_EN = /\b(paid|settled|cleared|no\s+debt|fully\s+paid|debt\s+(?:is\s+)?closed)\b/i;
const CALL_EN = /\b(called|phoned|rang|call(?:ed)?\s+the\s+client)\b/i;
const NEG_EN = /\b(not|no|haven'?t|hasn'?t|didn'?t|did\s+not|won'?t|never)\s+(?:\w+\s+){0,2}?(sent|submitted|filed|received|got|provided|prepared|paid|settled|done|completed)\b/i;
// English notification / mailing stem — «we remind / notify / inform you …»,
// «this is a reminder», «notice about taxes». Mirrors NOTIFY_RU / NOTIFY_HY so a
// tax/salary рассылка written in English is detected the same way.
const NOTIFY_EN =
  /\b(remind(?:er|ing|s|ed)?|notif(?:y|ies|ied|ication)|inform(?:ing|ed|ation)?|notice|please\s+be\s+(?:informed|advised)|we\s+are\s+writing\s+to)\b/i;

// --- Negation detectors ------------------------------------------------------
// "не <опц. 1-2 слова> <глагол-выполнения>" — a completion that did NOT happen.
const NEG_DONE_RU =
  /(?<![а-яёА-ЯЁ])не\s+(?:[а-яёА-ЯЁ]+\s+){0,2}?(получ|пришл|прислал|подпис|сдал|сдела|сдан|подан|предостав|скинул|сброс|отправ|выслал|переслал|направ|подал|загруз|выгруз|отчита|задеклар|готов|выполн|оформ|провед|провёл|провел)/i;
// "не оплачен / не выплатил / не погашен / не закрыт" — debt still open.
const NEG_PAID_RU =
  /(?<![а-яёА-ЯЁ])не\s+(?:[а-яёА-ЯЁ]+\s+){0,2}?(оплат|оплач|выплат|погас|закрыт)/i;
// Armenian negation prefix չ- covering the done/paid verb families.
const NEG_HY =
  /չ(?:ի|ե[մսնք]|եք|կա|ստաց|ուղարկ|ներկայաց|հանձն|տրամ|վճար|մար|փակ|կատար|արվ)/u;

// --- Completion (done) verb fragments ---------------------------------------
// Explicit forms for "отправил/..." so the done side never matches the
// imperative REQUEST "отправьте". "сделал/готово/оформил/провёл" added so
// plain «Зарплата — сделано» is recognized.
const DONE_TAX_RU =
  /(отправ|подал|подан|сдан|направил|загрузил|выгрузил|сдала|отправила|отчита|задеклар|сдела|оформ|готов)/i;
const DONE_RECV_RU =
  /(получ|пришл|прислал|подпис|сдал|предоставил|скинул|сбросил|прислала|получила|пришла|передал|отправил|отправила|отправлен|отправлена|отправили|выслал|переслал|сдела|сделан|готов|выполн|оформ|провед|провёл|провел)/i;
// + «просим/просят/предоставьт» — штатный шаблон-запрос документов до 28 числа
// («Просим вас предоставить следующую информацию…: инвойс, акт, счёт-фактура,
// данные для расчёта заработной платы»). Раньше «просим»/«предоставьте» не
// ловились (был только «прошу»/«просьб»), и запрос документов/ЗП не подтягивался.
const REQ_RU =
  /(запрос|прошу|просим|просят|просьб|нужн|пришлит|отправьт|скиньт|передайт|предоставьт|пожалуйст|жду|ожида)/i;
// «Рассылка отправлена» markers — the accountant SENT the periodic notification
// (Маргарита: «после отправки рассылки статус должен стать Получил»). Sending
// the mailing IS the completed action, even when the body says "нет зарплаты в
// этом периоде" — so these are NOT suppressed by negation.
// v11: добавлены формы 1-го лица наст. вр. (сообщаю/сообщаем — стем «сообща»,
// «напоминаю», «направляю») — accountant пишет от себя: «Направляю таблицу по
// заработным платам», «Сообщаю, что …», «Напоминаю о …». «сообща» умышленно НЕ
// «сообщ», чтобы не ловить запрос «сообщите …» / существительное «сообщение».
const NOTIFY_RU =
  /(рассыл|разосл|разошл|уведомл|уведомил|уведомля|сообща|сообщил|сообщу|информир|напоминаем|напомнил|напоминаю|направля)/i;
// Salary «done» — accountant SENT the payroll / posted the payments to the bank
// (штатный шаблон до 10 числа: «Направляю таблицу по заработным платам, оплаты
// проставлены в банке»; «перечислил/перевёл зарплату»; «выплаты произведены»).
// Эти глаголы отсутствовали в DONE_RECV_RU (тот про ПОЛУЧЕНИЕ ведомостей от
// клиента), поэтому ЗП-рассылка «направил/перечислил/проставил» не подтягивалась.
const SALARY_SENT_RU =
  /(направ|перечисл|перечислен|перевел|перевёл|переведен|перевед[её]н|простав|произвел|произвед|выставил\w*\s+(?:в\s+банк|оплат))/i;
// --- Service-payment reminder (оплата бухгалтерских услуг, до 5 числа) --------
// Штатная рассылка «оплата услуг»/по долгам (до 5 числа) ПОЧТИ НИКОГДА не содержит
// слова «долг»: «Оплатите бухгалтерские услуги до X числа», «Напоминаем о
// необходимости произвести оплату для продолжения работы», реквизиты банка +
// «payment for accountant service». Маргарита: «рассылка по долгам/оплате услуг
// часто не подтягивается автоматически». Требуем ПОБУДИТЕЛЬНУЮ/напоминательную
// форму («оплатите», «произвести оплату», «напоминаем … оплат», «просим
// оплатить», банковское назначение платежа), чтобы приветственный шаблон с полем
// «Срок оплаты услуг:» НЕ давал ложного срабатывания. Даёт debts:req.
const SVC_PAY_REMINDER =
  /(?:оплатите\s+(?:бухгалтерск|наши\s+услуг|услуг)|произвести\s+оплату|о\s+необходимости\s+(?:произвести\s+)?оплат|напоминаем[^.!?]{0,40}?оплат|напоминаем\s+о\s+(?:необходимости\s+)?(?:произвести\s+)?оплат|просим\s+оплат|оплат\w*\s+бухгалтерск\w*\s+услуг|payment\s+for\s+account(?:ant|ing)\s+servic|pay\s+for\s+account(?:ing|ant)\s+servic|կատարեք\s+հաշվապահական\s+ծառայ\w*\s+վճար|վճարումը\s+կատար|խնդրում\s+ենք\s+վճար\w*\s+կատար|հաշվապահական\s+ծառայ\w*\s+վճար)/iu;
// Armenian notification stem: «Տեղեկացնում ենք …» (we inform), «հիշեցնում» (remind).
const NOTIFY_HY = /(տեղեկացն|հիշեցն|տեղեկացր)/iu;
// Armenian REQUEST markers: «խնդրում ենք» (we ask), «կարիք», «պետք է» (need),
// «ցանկալի է» (it is desirable). Stem «խնդր» covers խնդրում/խնդրե/խնդրանք. Used
// both to FIRE a req rule and to GUARD the done rules — «խնդրում ենք տրամադրել»
// ("please provide") is a request, not a completed «տրամ»(provided) action.
const REQ_HY = /(խնդր|կարիք|պե՞?տք|ցանկալի|աղերս)/iu;
// Russian tax-notification structure: the accountant lists the taxes to pay and
// the settlement/treasury accounts to pay them to («оплатить на расчётные
// счета», «реквизиты», «к оплате», «перечислить»). This IS the sent tax mailing.
const NOTIFY_TAX_RU =
  /(расчетн\w*\s*счет|расчётн\w*\s*счет|оплат\w*\s+на\s+(?:соответств\w*\s+)?(?:расчетн|расчётн)|реквизит|к\s+оплате|необходимо\s+оплат|перечисл)/i;

// --- Scoped negation of the SENDING / notification verb (v8) -----------------
// PARITY: mirrored 1:1 in db/migrations/20260714_mqa_detect_mailings_v8_scoped_send_negation.sql
// (neg_send / neg_send_hy). Keep identical.
//
// NEG_SEND_RU: «рассылку не отправили», «рассылка не сделана», «не разослал»,
// «не уведомил». Guards the salary NOTIFY-done rule and the main_taxes done
// rule (taxes are *sent*, never received). It deliberately OMITS the
// pure-receive verbs (получ/пришл/прислал/скинул/сброс/предостав/подпис) and the
// salary-CALCULATION verb (начисл) so that:
//   • «зарплата не начисляется» still counts the mailing as SENT (done), and
//   • an UNRELATED «документы не получила» in a mixed message does NOT suppress
//     a real salary send (scoped to the send verb — not a blunt whole-text «не»).
// v11: включены новые глаголы отправки ЗП (перечисл/перевёл/переведен/простав/
// произвел/произвед), чтобы «зарплату не перечислил / не перевёл / не проставил»
// оставались НЕ выполненными. «производится» (начисление не производится) не
// совпадает со стемами произвед/произвел → шаблон «нет сотрудников» всё ещё done.
const NEG_SEND_RU =
  /(?<![а-яёА-ЯЁ])не\s+(?:[а-яёА-ЯЁ]+\s+){0,2}?(рассыл|разосл|разошл|уведом|сообщ|информир|напомн|отправ|выслал|переслал|направ|перечисл|перевел|перевёл|переведен|простав|произвел|произвед|подал|подан|сдан|сдела|сделан|загруз|выгруз|отчита|задеклар|оформ|провед|провёл|провел|готов|выполн)/i;
// NEG_SEND_HY: Armenian scoped negation of the sending/notification verb. Two
// shapes: (1) prefix «չ»+send-verb (չուղարկ/չտեղեկաց…); (2) auxiliary
// «չեմ/չենք/չի…» immediately (≤2 words) before a send verb. It OMITS կատար so
// the «աշխատավարձի հաշվարկ չի կատարվում» template (no salary this period) is
// STILL a sent mailing (done); it also omits ստաց/վճար/մար/փակ.
const NEG_SEND_HY =
  /չ(?:ուղարկ|ներկայաց|հանձն|տեղեկաց|հիշեց|առաք|ցր)|չ(?:ի|ե[մսնք]{1,2}|կա)\s+(?:[^\s]+\s+){0,2}?(?:ուղարկ|ներկայաց|հանձն|տեղեկաց|հիշեց|առաք|ցր)/u;

// --- Generic mailing / notification marker (v12 — SOFT catch-all) ------------
// The single, deliberately BROAD rule that guarantees every рассылка type is
// identified even when no specific action verb matched: an explicit mailing /
// notification word next to a category keyword IS that category's рассылка.
// Маргарита: рассылка (по налогам / зарплате / документам / долгам) часто НЕ
// подтягивается автоматически и приходится отмечать вручную — этот мягкий catch
// закрывает пробел для формулировок-вариантов («оповещаем», «извещаем»,
// «информационное письмо», «напоминание» и т.п.), которых нет в узких списках
// глаголов. Негативные охранники ниже не дают «рассылку не отправил» засчитаться.
//   RU: рассылка / уведомление / напоминание / информируем / оповещаем / извещаем
//   HY: տեղեկացնում / հիշեցնում / ծանուցում / իրազեկում
//   EN: mailing / newsletter / notification / notice / reminder / inform
const MAILING_RU =
  /(рассыл|разосл|разошл|уведомл|уведомил|уведомля|напоминани|напоминаем|напоминаю|напомнил|напомин|информир|информацион|оповещ|извещ|оповестил|известил)/i;
const MAILING_HY = /(տեղեկացն|տեղեկացր|հիշեցն|ծանուց|իրազեկ)/iu;
const MAILING_EN =
  /\b(mailing|newsletter|notification|notify|notice|remind(?:er|ing|s|ed)?|inform(?:ing|ed|ation)?)\b/i;

const RULES: Rule[] = [
  // --- main_taxes (Russian) -------------------------------------------------
  // Taxes are *sent*, never received → the negation guard is scoped to the
  // SEND verb (NEG_SEND_RU), so an unrelated receive-negation elsewhere in the
  // message («налоги отправил, зарплату не получил») does NOT flip it to «neg».
  { category: "main_taxes", type: "done", all: [KW.taxes_ru, DONE_TAX_RU], none: [NEG_SEND_RU] },
  // Tax-notification mailing: the accountant POSTS the taxes to pay + the
  // treasury/settlement accounts («…необходимо оплатить на соответствующие
  // расчётные счета», реквизиты, «к оплате»). Listing taxes to pay by account IS
  // the sent tax mailing → «Отправил», even without an explicit "отправил" verb.
  // v11: guard SVC_PAY_REMINDER — шаблон «оплата услуг до 5 числа» упоминает
  // «налоговую оптимизацию» + «Реквизиты», из-за чего засчитывался как ОТПРАВКА
  // НАЛОГОВ. Это рассылка по оплате услуг (debts), не налоговая — суппрессируем.
  { category: "main_taxes", type: "done", all: [KW.taxes_ru, NOTIFY_TAX_RU], none: [NEG_SEND_RU, SVC_PAY_REMINDER] },
  // Общая рассылка-УВЕДОМЛЕНИЕ по налогам: «Уведомляем/Напоминаем/Сообщаем о
  // суммах налога к уплате», «Разослали налоговую рассылку», «Информируем о
  // налогах за период». Раньше налоги (в отличие от зарплаты) НЕ использовали
  // общий стем уведомления NOTIFY_RU, поэтому рассылка по налогам,
  // сформулированная как напоминание/уведомление без явного глагола отправки и
  // без шаблона реквизитов, НЕ подхватывалась автоматически (Маргарита:
  // «платформа не подтягивает из чатов рассылку по налогам, отмечаю вручную»).
  // Отправка рассылки = выполненное действие → «Отправил». Guard NEG_SEND_RU
  // (налоги отправляются, поэтому суппрессируется только негатив отправки).
  { category: "main_taxes", type: "done", all: [KW.taxes_ru, NOTIFY_RU], none: [NEG_SEND_RU, SVC_PAY_REMINDER] },
  { category: "main_taxes", type: "neg", all: [KW.taxes_ru, NEG_SEND_RU] },
  // --- main_taxes (Armenian) ------------------------------------------------
  // հարկ=tax, ԱԱՀ=VAT, հայտ=declaration, ուղարկ=sent, ներկայաց=submitted
  {
    category: "main_taxes",
    type: "done",
    all: [KW.taxes_hy, /(ուղարկ|ներկայաց|հանձնե|բեռնե|ներբեռն)/iu],
    none: [NEG_HY],
  },
  // Армянская рассылка-уведомление по налогам: «Տեղեկացնում ենք … հարկ …»
  // (мы информируем о налогах) / «հիշեցնում ենք» (напоминаем) — как у зарплаты.
  { category: "main_taxes", type: "done", all: [KW.taxes_hy, NOTIFY_HY], none: [NEG_SEND_HY] },
  { category: "main_taxes", type: "neg", all: [KW.taxes_hy, NEG_HY] },

  // --- salary (Russian) -----------------------------------------------------
  { category: "salary", type: "done", all: [KW.salary_ru, DONE_RECV_RU], none: [NEG_DONE_RU] },
  // v11: accountant SENT the payroll table / posted payments to the bank
  // («Направляю таблицу по заработным платам, оплаты проставлены в банке»,
  // «перечислил зарплату», «выплаты произведены») → «Получил». Guarded by
  // NEG_SEND_RU so «зарплату не перечислил» / «не направил» stays not-done.
  { category: "salary", type: "done", all: [KW.salary_ru, SALARY_SENT_RU], none: [NEG_SEND_RU] },
  // Sending the salary рассылка (notification) = done → «Получил». v8: guarded by
  // NEG_SEND_RU so a negated SEND («рассылку не отправила», «не разослал») is NOT
  // marked done, while «зарплата не начисляется» (calc negated) STILL is.
  { category: "salary", type: "done", all: [KW.salary_ru, NOTIFY_RU], none: [NEG_SEND_RU] },
  { category: "salary", type: "req", all: [KW.salary_ru, REQ_RU] },
  { category: "salary", type: "neg", all: [KW.salary_ru, NEG_DONE_RU] },
  // A negated SEND also surfaces as «neg» so «не разослал…» reads as not-done.
  { category: "salary", type: "neg", all: [KW.salary_ru, NEG_SEND_RU] },
  // --- salary (Armenian) ----------------------------------------------------
  // աշխատավարձ=salary, հաշվետ=payroll, ստացական=receipt, ցուցակ=list
  {
    category: "salary",
    type: "done",
    all: [KW.salary_hy, /(ստաց|ուղարկ|տրամ|ստ\.)/iu],
    none: [NEG_HY, REQ_HY],
  },
  // «Տեղեկացնում ենք … աշխատավարձ …» — the salary рассылка was SENT (incl. the
  // "no salary this period" «չի կատարվում» template → STILL done). v8: guarded by
  // NEG_SEND_HY, which suppresses only a negated SEND verb («չենք տեղեկացրել»),
  // never the calc negation «չի կատարվում».
  { category: "salary", type: "done", all: [KW.salary_hy, NOTIFY_HY], none: [NEG_SEND_HY] },
  {
    category: "salary",
    type: "req",
    all: [/(աշխատավարձ|աշխ\.?\s*վ|ա\/վ|ռոճիկ)/iu, REQ_HY],
  },
  { category: "salary", type: "neg", all: [KW.salary_hy, NEG_HY] },

  // --- primary_docs (Russian) -----------------------------------------------
  { category: "primary_docs", type: "done", all: [KW.primary_ru, DONE_RECV_RU], none: [NEG_DONE_RU] },
  {
    category: "primary_docs",
    type: "req",
    all: [
      /(первичн|первичк|(?<![а-яёА-ЯЁ])акт(?:ами|ах|ов|ом|ам|[ыауе])?(?![а-яёА-ЯЁ])|документ|накладн)/i,
      REQ_RU,
    ],
  },
  { category: "primary_docs", type: "neg", all: [KW.primary_ru, NEG_DONE_RU] },
  // --- primary_docs (Armenian) ----------------------------------------------
  // փաստաթ=document, [աՈ][կք]տ=act, հաշիվ=invoice; iu = Unicode case-fold
  {
    category: "primary_docs",
    type: "done",
    all: [KW.primary_hy, /(ստաց|ուղարկ|հանձնե|ստ\.)/iu],
    none: [NEG_HY, REQ_HY],
  },
  {
    category: "primary_docs",
    type: "req",
    all: [/(փաստաթ|[աՈ][կք]տ|հաշիվ|ինվոյս|ֆակտուր)/iu, REQ_HY],
  },
  { category: "primary_docs", type: "neg", all: [KW.primary_hy, NEG_HY] },

  // --- debts (Russian) ------------------------------------------------------
  {
    category: "debts",
    type: "paid",
    all: [
      KW.debts_ru,
      /(оплатил|оплатила|оплачен|оплачена|оплачено|оплата\s+прошла|выплатил|выплатила|погашен|погасил|закрыт|закрыта|нет\s+долга|нет\s+задолж)/i,
    ],
    none: [NEG_PAID_RU],
  },
  {
    category: "debts",
    type: "call",
    all: [/(долг|задолженност)/i, /(позвон|звонил|звонок|обзвон|перезвон|созвон)/i],
  },
  {
    category: "debts",
    type: "req",
    // Рассылка по долгам обычно звучит как «НАПОМИНАЕМ о задолженности»,
    // «ПРОСИМ/ПРОСЬБА оплатить», «ОПЛАТИТЕ до…», «УВЕДОМЛЯЕМ о наличии
    // задолженности», «РАЗОСЛАЛИ напоминание по долгам» — раньше многие формы не
    // ловились (стем «напоминани» не совпадал с «напоминаем», «уведомил» не
    // совпадал с «уведомляем»), поэтому долг-рассылка часто не подтягивалась.
    // Переходим на СТЕМЫ (напомн/напомин/уведом/сообщ/…), покрывающие все склонения
    // и формы обращения. `оплатит`/`погасит` — только инфинитив/повелит. просьбы;
    // совершённая оплата («оплачен»/«погашен») ловится отдельным `paid`-правилом,
    // которое в deriveStatus всё равно перебивает `req`.
    all: [
      KW.debts_ru,
      /(напис|напомн|напомин|уведом|сообщ|информир|прос(?:им|ьб|ит)|оплатит|оплатите|погасит|к\s+оплате|рассыл|разосл|разошл)/i,
    ],
  },
  // v11: Service-payment reminder (оплата бухгалтерских услуг, до 5 числа) — the
  // штатный шаблон has NO «долг» word, so none of the debts-keyword rules above
  // fire. SVC_PAY_REMINDER is itself the specific marker (imperative/reminder +
  // «услуг»/bank purpose line), so it stands alone as a debts:req signal.
  { category: "debts", type: "req", all: [SVC_PAY_REMINDER] },
  // --- debts (Armenian) — iu = Unicode case-fold handles sentence-start capitals
  // պարտք=debt, վճար=pay, զանգ=call, գր=wrote, հուշ=reminder
  {
    category: "debts",
    type: "paid",
    all: [KW.debts_hy, /(վճար|մարե|փակե|չկա\s+պ|պարտք\s+չ)/iu],
    none: [NEG_HY],
  },
  { category: "debts", type: "call", all: [KW.debts_hy, /(զանգ|զ\.)/iu] },
  { category: "debts", type: "req", all: [KW.debts_hy, /(գր[եէ]|հուշ|տեղեկ|ծանուց)/iu] },

  // --- main_taxes (English) — taxes are *sent* -----------------------------
  { category: "main_taxes", type: "done", all: [KW.taxes_en, DONE_SENT_EN], none: [NEG_EN] },
  // English tax-notification mailing: «we remind you of the taxes due …»,
  // «notification of taxes for the period» → sent = «Отправил». Parity with RU/HY.
  { category: "main_taxes", type: "done", all: [KW.taxes_en, NOTIFY_EN], none: [NEG_EN] },
  { category: "main_taxes", type: "neg", all: [KW.taxes_en, NEG_EN] },
  // --- salary (English) -----------------------------------------------------
  { category: "salary", type: "done", all: [KW.salary_en, DONE_RECV_EN], none: [NEG_EN] },
  // Salary-notification mailing in English → sent = «Получил». Parity with RU/HY.
  { category: "salary", type: "done", all: [KW.salary_en, NOTIFY_EN], none: [NEG_EN] },
  { category: "salary", type: "req", all: [KW.salary_en, REQ_EN] },
  { category: "salary", type: "neg", all: [KW.salary_en, NEG_EN] },
  // --- primary_docs (English) ----------------------------------------------
  { category: "primary_docs", type: "done", all: [KW.primary_en, DONE_RECV_EN], none: [NEG_EN] },
  { category: "primary_docs", type: "req", all: [KW.primary_en, REQ_EN] },
  { category: "primary_docs", type: "neg", all: [KW.primary_en, NEG_EN] },
  // --- debts (English) ------------------------------------------------------
  { category: "debts", type: "paid", all: [KW.debts_en, PAID_EN], none: [NEG_EN] },
  { category: "debts", type: "call", all: [KW.debts_en, CALL_EN] },
  { category: "debts", type: "req", all: [KW.debts_en, /\b(wrote|reminded|messaged|reminder|notified|sent\s+a\s+reminder)\b/i] },

  // --- v12: SOFT catch-all — a category keyword + a generic mailing word is ---
  // enough to identify the рассылка, so no type is ever missed for lack of a
  // specific verb. Sent categories (taxes/salary) → done, guarded by the scoped
  // send-negation; requested categories (docs/debts) → req. Onboarding welcome
  // templates are still stripped of done/paid in classifyMessage, so a mailing
  // word inside a welcome message can never become «Отправил»/«Получил».
  // Russian:
  { category: "main_taxes", type: "done", all: [KW.taxes_ru, MAILING_RU], none: [NEG_SEND_RU, SVC_PAY_REMINDER] },
  { category: "salary", type: "done", all: [KW.salary_ru, MAILING_RU], none: [NEG_SEND_RU] },
  { category: "primary_docs", type: "req", all: [KW.primary_ru, MAILING_RU], none: [NEG_DONE_RU] },
  { category: "debts", type: "req", all: [KW.debts_ru, MAILING_RU] },
  // Armenian:
  { category: "main_taxes", type: "done", all: [KW.taxes_hy, MAILING_HY], none: [NEG_SEND_HY] },
  { category: "salary", type: "done", all: [KW.salary_hy, MAILING_HY], none: [NEG_SEND_HY] },
  { category: "primary_docs", type: "req", all: [KW.primary_hy, MAILING_HY] },
  { category: "debts", type: "req", all: [KW.debts_hy, MAILING_HY] },
  // English:
  { category: "main_taxes", type: "done", all: [KW.taxes_en, MAILING_EN], none: [NEG_EN] },
  { category: "salary", type: "done", all: [KW.salary_en, MAILING_EN], none: [NEG_EN] },
  { category: "primary_docs", type: "req", all: [KW.primary_en, MAILING_EN] },
  { category: "debts", type: "req", all: [KW.debts_en, MAILING_EN] },
];

/**
 * Онбординг / сервис-информация — приветственный шаблон нового клиента
 * («…ваш ведущий бухгалтер… Налоговая система: … Даты оплаты налогов: …»).
 * Он МОЖЕТ упоминать налоги/сроки, но это НЕ выполненная рассылка. Мы помечаем
 * такое сообщение, чтобы классификатор никогда не засчитал его как «Отправил»/
 * «Получил» (см. classifyMessage). Требуется несколько маркеров онбординга.
 */
const ONBOARDING_MARKERS: RegExp[] = [
  /ведущ\w*\s+бухгалтер/i,
  /бухгалтерск\w*\s+обслуживани/i,
  /за\s+доверие|спасибо\s+вам\s+за/i,
  /налогов\w*\s+систем\w*\s*[:—-]/i,
  /срок\w*\s+оплаты\s+услуг/i,
  /сумм\w*\s+обслуживани/i,
  /меня\s+зовут/i,
  /вид\s+деятельности\s*[:—-]/i,
  /հաշվապահական\s+սպասարկ/iu,
  /ձեր\s+վարող\s+հաշվապահ/iu,
];

/** True when a message is a client-onboarding / service-info template. */
export function isOnboardingMessage(text: string): boolean {
  if (!text) return false;
  let hits = 0;
  for (const re of ONBOARDING_MARKERS) if (re.test(text)) hits += 1;
  return hits >= 2;
}

/**
 * Text content of a message for detection: the body PLUS any media caption.
 * A debt/tax/salary рассылка is often a photo/PDF with the wording in the
 * CAPTION and an empty `text`; scanning `text` alone missed those entirely.
 */
export function messageContent(msg: { text?: string | null; caption?: string | null }): string {
  return [msg.text, msg.caption].filter((s): s is string => Boolean(s)).join("\n");
}

/** All signals fired by a single message (may be several categories). */
export function detectAllSignals(text: string): MailingSignal[] {
  if (!text || text.length < 4) return [];
  const out: MailingSignal[] = [];
  const seen = new Set<string>(); // deduplicate (category, type) pairs
  for (const rule of RULES) {
    if (!rule.all.every((re) => re.test(text))) continue;
    if (rule.none && rule.none.some((re) => re.test(text))) continue;
    const key = `${rule.category}|${rule.type}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ category: rule.category, type: rule.type });
    }
  }
  return out;
}

export interface SignalCounts {
  done: number;
  req: number;
  call: number;
  paid: number;
  neg: number;
}

/**
 * Derive the final mailing status for a category from accumulated signal
 * counts across all messages in a period. Call this after counting signals
 * from every message.
 *
 * `done` always wins (a real completion later in the cycle overrides an earlier
 * "not yet"). An explicit `neg` with no completion surfaces as a "not done"
 * status so the panel flags it instead of leaving it neutral («Предстоящая»).
 */
export function deriveStatus(
  category: string,
  counts: { done: number; req: number; call: number; paid: number; neg?: number }
): string | null {
  const neg = counts.neg ?? 0;
  switch (category) {
    case "main_taxes":
      if (counts.done >= 1) return "Отправил";
      if (neg >= 1) return "Не отправил";
      return null;

    case "salary":
      if (counts.done >= 1) return "Получил";
      if (counts.req >= 2) return "Запросил 2, не получил";
      if (counts.req === 1) return "Запросил 1, не получил";
      if (neg >= 1) return "Запросил 1, не получил";
      return null;

    case "primary_docs":
      if (counts.done >= 1) return "Получил";
      if (counts.req >= 2) return "Запросил 2, не получил";
      if (counts.req === 1) return "Запросил 1, не получил";
      if (neg >= 1) return "Запросил 1, не получил";
      return null;

    case "debts":
      if (counts.paid >= 1) return "Нет долга";
      if (counts.call >= 1) return "1-й позвонил";
      if (counts.req >= 2) return "2-й написал";
      if (counts.req === 1) return "1-й написал";
      return null;

    default:
      return null;
  }
}
