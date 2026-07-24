-- ---------------------------------------------------------------------------
-- Align the client-notification templates to the messages accountants ACTUALLY
-- send (verified against the live `messages` table, sender_role accountant/
-- manager/head_accountant). The 20260725 seed was close but slightly generic;
-- this replaces the four RU bodies with the real wording and adds the real
-- tax-optimization example line to the services-payment reminder in every
-- language. No structural change: same ids, same {placeholders}, same modes.
--
-- Verified real examples (RU):
--   salary  "Добрый день! Направляю таблицу по заработным платам, также
--            сообщаю, что оплаты проставлены в банке."
--   taxes   "Добрый день! Отчёт подготовлен и сдан. Следующим сообщением
--            направляю ПДФ отчёта, а также расчёт налогов. Налоги выставлены
--            в банке, прошу зайти, подтвердить оплаты."
--   docs    the real multi-point "просим предоставить следующую информацию …"
--   debts   the real "ДЛЯ СДАЧИ ОТЧЁТНОСТИ И ПОЛУЧЕНИЯ НАЛОГОВОЙ ОПТИМИЗАЦИИ …"
--           incl. the "Например: 99 999 драм → …" optimization example line.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='mqa_notification_templates') then
    raise exception 'Prerequisite missing: apply 20260723_mqa_notifications_v1.sql first.';
  end if;
end $$;

update mqa_notification_templates set body =
$tpl$Добрый день! Направляю таблицу по заработным платам, также сообщаю, что оплаты проставлены в банке.$tpl$,
updated_at=now() where id='salary:done:ru';

update mqa_notification_templates set body =
$tpl$Добрый день! Отчёт подготовлен и сдан. Следующим сообщением направляю ПДФ отчёта, а также расчёт налогов. Налоги выставлены в банке, прошу зайти, подтвердить оплаты.$tpl$,
updated_at=now() where id='main_taxes:req:ru';

update mqa_notification_templates set body =
$tpl$Для своевременного составления отчётности просим предоставить следующую информацию за {period} (присылайте только относящуюся к вам):

1. Информация по выставляемым счетам (инвойс, акт выполненных работ, счёт-фактура).
2. Любые документы, связанные с импортом или экспортом: договор, инвойс, CMR, декларация (наземная или воздушная), УПД/товарная накладная, коды ТН ВЭД и вес товара. Желательно сразу после получения.
3. Банковская выписка по всем счетам и валютам, с начала года до конца соответствующего месяца.
4. Данные для расчёта заработной платы (желательно сразу после уточнения или изменения).
5. Было ли у вас действующее ВНЖ или Work Permit в 2026 году? Если да — укажите период.

Заранее благодарим!$tpl$,
updated_at=now() where id='primary_docs:req:ru';

update mqa_notification_templates set body =
$tpl$ДЛЯ СДАЧИ ОТЧЁТНОСТИ И ПОЛУЧЕНИЯ НАЛОГОВОЙ ОПТИМИЗАЦИИ

Оплатите бухгалтерские услуги до {due_day} числа — мы учтём их в расходах текущего периода и снизим налоговую нагрузку.
Например: 99 999 драм → уменьшение налогооблагаемой базы на 99 999 драм.

Для соблюдения сроков и непрерывности работы просим оплатить услуги (за период {period}). Отчётность сдаётся только после оплаты услуг.

Реквизиты:
• р/с: 1930097970708600 (AMD)
• банк: Converse Bank
• получатель: Business Tech LLC
• ИНН: 02909907
• назначение: payment for accountant service
• сумма: {amount} драм
• период: {period}

После оплаты продолжаем работу в полном объёме.

Спасибо!$tpl$,
updated_at=now() where id='debts:req:ru';

update mqa_notification_templates set body =
$tpl$ՀԱՇՎԵՏՎՈՒԹՅԱՆ ՀԱՆՁՆՄԱՆ ԵՎ ՀԱՐԿԵՐՆ ՕՊՏԻՄԱԼԱՑՆԵԼՈՒ ՀԱՄԱՐ

Կատարեք հաշվապահական ծառայությունների վճարումը մինչև ամսի {due_day}-ը, որպեսզի այն ներառենք ընթացիկ ժամանակահատվածի ծախսերում և նվազեցնենք հարկային բեռը։
Օրինակ՝ 99 999 դրամ → հարկվող բազայի նվազում 99 999 դրամով։

Ժամկետների պահպանման համար խնդրում ենք վճարումը կատարել ({period} ժամանակահատվածի համար)։ Հաշվետվությունը ներկայացվում է միայն վճարումից հետո։

Վճարման տվյալներ՝
• հ/հ՝ 1930097970708600 (AMD)
• բանկ՝ Converse Bank
• ստացող՝ Business Tech LLC
• ՀՎՀՀ՝ 02909907
• նշանակություն՝ payment for accountant service
• գումար՝ {amount} դրամ
• ժամանակահատված՝ {period}

Վճարումից հետո շարունակում ենք աշխատանքը ամբողջ ծավալով։

Շնորհակալություն։$tpl$,
updated_at=now() where id='debts:req:hy';

update mqa_notification_templates set body =
$tpl$FOR REPORT SUBMISSION AND TAX OPTIMIZATION

Please pay for accounting services by the {due_day}th of the month — we will include them in the current period's expenses and reduce the tax burden.
For example: 99,999 AMD → the taxable base is reduced by 99,999 AMD.

To meet deadlines and ensure continuity of work, please make the payment (for the period {period}). Reports are submitted only after payment.

Bank details:
• Account: 1930097970708600 (AMD)
• Bank: Converse Bank
• Beneficiary: Business Tech LLC
• TIN: 02909907
• Purpose: payment for accountant service
• Amount: {amount} AMD
• Period: {period}

After payment we continue working in full.

Thank you!$tpl$,
updated_at=now() where id='debts:req:en';

update mqa_notification_templates set body =
$tpl$提交报表及税务优化

请于每月{due_day}日前支付会计服务费用，以便计入当期成本并降低税负。
例如：99 999 AMD → 应税基数减少 99 999 AMD。

为确保按时提交及工作连续，请完成付款（期间：{period}）。报表仅在付款后提交。

付款信息：
• 账户：1930097970708600 (AMD)
• 银行：Converse Bank
• 收款方：Business Tech LLC
• 税号：02909907
• 用途：payment for accountant service
• 金额：{amount} AMD
• 期间：{period}

付款后我们将继续提供完整服务。
谢谢！$tpl$,
updated_at=now() where id='debts:req:zh';
