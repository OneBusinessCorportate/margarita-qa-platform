-- ---------------------------------------------------------------------------
-- Real client-notification templates (owner-provided wording) + personalization.
--
-- Replaces the draft seed with the actual messages the accountants send, in
-- RU/HY/EN (+ ZH for the document request and the services-payment reminder),
-- and upgrades the planner to fill the per-client fields it CAN ground in data:
--   {company}  — the client name (mqa_chats.name_agr, else chat_name/agr_no)
--   {amount}   — the real services debt (mqa_chats.debts, numeric only)
--   {period}   — the billing date range for the services payment
--   {month}    — the reporting month for the primary-docs request (localised)
--   {due_day}  — the category due day
-- Tax and salary amounts are NOT in the database (the accountant computes them),
-- so those messages stay MANUAL: the fixed wording goes out and the accountant
-- attaches the tax-calculation PDF / salary table. Bank/transfer details are the
-- fixed Business Tech LLC / Converse Bank requisites, literal in the debt text.
--
-- approved=true: the owner supplied this exact wording. Live client sending is
-- still gated by NOTIFICATIONS_SEND_ENABLED (and test mode) — this only unblocks
-- the wording check, not delivery.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='mqa_notification_templates') then
    raise exception 'Prerequisite missing: apply 20260723_mqa_notifications_v1.sql first.';
  end if;
end $$;

insert into mqa_notification_templates (id, category, subtype, language, mode, title, body, requires_attachment, approved, active)
values
  -- ── Taxes (до 15) — MANUAL: short message + attached tax-calculation PDF ──
  ('main_taxes:req:ru','main_taxes','req','ru','manual','Налоги — отчёт сдан, налоги в банке',
   'Добрый день! Отчёт подготовлен и сдан. Следующим сообщением направляю ПДФ отчёта, а также расчёт налогов. Налоги выставлены в банке, прошу зайти, подтвердить оплаты.', true, true, true),
  ('main_taxes:req:hy','main_taxes','req','hy','manual','Հարկեր — հաշվետվությունը ներկայացված է',
   'Բարի օր։ Հաշվետվությունը պատրաստ է և ներկայացված։ Հաջորդ հաղորդագրությամբ կուղարկեմ հաշվետվության PDF տարբերակը, ինչպես նաև հարկերի հաշվարկը։ Հարկերը նշված են բանկում, խնդրում եմ մուտք գործել և հաստատել վճարումները։', true, true, true),
  ('main_taxes:req:en','main_taxes','req','en','manual','Taxes — report submitted',
   'Good day! The report has been prepared and submitted. In my next message I will send the PDF of the report and the tax calculation. The taxes are available in the bank system; please log in and approve the payments.', true, true, true),

  -- ── Salary (до 10) — MANUAL: short message + attached salary table ──
  ('salary:done:ru','salary','done','ru','manual','Зарплата — таблица направлена',
   'Добрый день! Направляю таблицу по заработным платам, также сообщаю, что оплаты проставлены в банке.', true, true, true),
  ('salary:done:hy','salary','done','hy','manual','Աշխատավարձ — աղյուսակն ուղարկված է',
   'Բարի օր։ Ուղարկում եմ աշխատավարձերի աղյուսակը, ինչպես նաև տեղեկացնում եմ, որ վճարումները նշվել են բանկում։', true, true, true),
  ('salary:done:en','salary','done','en','manual','Salary — table sent',
   'Good day! I am sending the salary table and would also like to inform you that the payments have been entered in the bank system.', true, true, true),

  -- ── Primary docs (до 28) — AUTO, per-month request ──
  ('primary_docs:req:ru','primary_docs','req','ru','auto','Первичка — запрос документов',
   'Уважаемые коллеги! Для своевременного составления отчётности просим предоставить следующую информацию за {month} (присылайте только относящуюся к вам; ранее отправленное повторно можно не присылать):
1. Информация по выставляемым счетам (инвойс, акт выполненных работ, счёт-фактура).
2. Документы по импорту/экспорту (договор, инвойс, CMR, декларация, товаросопроводительные документы, коды ТН ВЭД и вес товара) — желательно сразу после получения.
3. Банковские выписки по всем счетам и валютам, с начала года до конца соответствующего месяца.
4. Данные для расчёта заработной платы.
5. Было ли у вас действующее ВНЖ или Work Permit — если да, укажите период.
Заранее благодарим!', false, true, true),
  ('primary_docs:req:hy','primary_docs','req','hy','auto','Առաջնային փաստաթղթեր — հարցում',
   'Հարգելի գործընկերներ։ Հաշվետվությունների ժամանակին կազմման համար խնդրում ենք տրամադրել հետևյալ տեղեկատվությունը {month} ամսվա համար (միայն Ձեզ վերաբերողը)․
1. Դուրս գրվող հաշիվների վերաբերյալ տեղեկատվություն (ինվոյս, ակտ, հաշիվ-ապրանքագիր)։
2. Ներմուծման/արտահանման փաստաթղթեր (պայմանագիր, ինվոյս, CMR, հայտարարագիր, ապրանքային փաստաթղթեր, ՏՀ ՎԵԴ կոդեր, քաշ)։
3. Բանկային քաղվածքներ՝ բոլոր հաշիվներով և արժույթներով՝ տարվա սկզբից մինչև ամսվա ավարտ։
4. Աշխատավարձի հաշվարկի տվյալներ։
5. 2025թ․ ВНЖ կամ Work Permit-ի առկայությունը՝ նշելով ժամանակահատվածը։
Կանխավ շնորհակալություն։', false, true, true),
  ('primary_docs:req:en','primary_docs','req','en','auto','Primary documents — request',
   'Dear colleagues! To ensure timely and accurate preparation of reports, please provide the following information for {month} (only what applies to you):
1. Information on issued documents (invoice, act of completed works, tax invoice).
2. Import/export documents (contract, invoice, CMR, customs declaration, shipping documents, HS codes and weight) — preferably right after receipt.
3. Bank statements for all accounts and currencies, from the beginning of the year to the end of the relevant month.
4. Payroll calculation data.
5. Whether you had a valid residence permit (TRC) or Work Permit — if yes, indicate the period.
Thank you in advance!', false, true, true),
  ('primary_docs:req:zh','primary_docs','req','zh','auto','首要文件 — 请求',
   '尊敬的客户！为确保报表及时、准确地编制，请提供 {month} 的以下信息（仅提供与您相关的部分）：
1. 开具发票的相关信息（Invoice、服务确认单、发票）。
2. 进出口相关文件（合同、Invoice、CMR、报关单、商品文件、HS编码、重量）。
3. 所有银行账户及币种的银行流水（从年初至相应月份月底）。
4. 工资计算所需数据。
5. 2025年是否持有居留许可或工作许可，并注明有效期。
提前感谢您的配合！', false, true, true),

  -- ── Services payment / debt (до 5) — AUTO, real amount + fixed requisites ──
  ('debts:req:ru','debts','req','ru','auto','Оплата услуг — напоминание',
   'ДЛЯ СДАЧИ ОТЧЁТНОСТИ И ПОЛУЧЕНИЯ НАЛОГОВОЙ ОПТИМИЗАЦИИ

Оплатите бухгалтерские услуги до {due_day} числа — мы учтём их в расходах текущего периода и снизим налоговую нагрузку.

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

Спасибо!', false, true, true),
  ('debts:req:hy','debts','req','hy','auto','Ծառայությունների վճարում — հիշեցում',
   'ՀԱՇՎԵՏՎՈՒԹՅԱՆ ՀԱՆՁՆՄԱՆ ԵՎ ՀԱՐԿԵՐՆ ՕՊՏԻՄԱԼԱՑՆԵԼՈՒ ՀԱՄԱՐ

Կատարեք հաշվապահական ծառայությունների վճարումը մինչև ամսի {due_day}-ը, որպեսզի այն ներառենք ընթացիկ ժամանակահատվածի ծախսերում և նվազեցնենք հարկային բեռը։

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

Շնորհակալություն։', false, true, true),
  ('debts:req:en','debts','req','en','auto','Service payment — reminder',
   'FOR REPORT SUBMISSION AND TAX OPTIMIZATION

Please pay for accounting services by the {due_day}th of the month — we will include them in the current period''s expenses and reduce the tax burden.

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

Thank you!', false, true, true),
  ('debts:req:zh','debts','req','zh','auto','服务费 — 提醒',
   '提交报表及税务优化

请于每月{due_day}日前支付会计服务费用，以便计入当期成本并降低税负。

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
谢谢！', false, true, true)
on conflict (id) do update
  set mode = excluded.mode, title = excluded.title, body = excluded.body,
      requires_attachment = excluded.requires_attachment, approved = excluded.approved,
      active = excluded.active, updated_at = now();

-- Planner: fill the per-client fields; only send a services/debt reminder when
-- the client actually owes (mqa_chats.debts is a positive number).
create or replace function public.mqa_plan_notifications(
  ref_date date default ((now() at time zone 'Asia/Yerevan')::date)
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  planned_count integer := 0;
  plan_spec constant text[][] := array[
    array['salary','done','10'], array['main_taxes','req','15'],
    array['primary_docs','req','28'], array['debts','req','5']
  ];
  month_ru constant text[] := array['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  month_hy constant text[] := array['Հունվար','Փետրվար','Մարտ','Ապրիլ','Մայիս','Հունիս','Հուլիս','Օգոստոս','Սեպտեմբեր','Հոկտեմբեր','Նոյեմբեր','Դեկտեմբեր'];
  month_en constant text[] := array['January','February','March','April','May','June','July','August','September','October','November','December'];
  spec text[]; v_cat text; v_sub text; v_due int; v_chat record; v_lang text; v_tpl record;
  v_period text; v_sched date; v_text text; v_company text; v_amount text; v_month text; v_midx int;
begin
  for v_chat in
    select agr_no, coalesce(chat_name, agr_no) as chat_name, coalesce(language,'ru') as language,
           name_agr, hvhh, debts
    from mqa_chats where status = 'Active'
  loop
    v_company := coalesce(nullif(btrim(v_chat.name_agr),''), v_chat.chat_name, v_chat.agr_no);
    -- Parse the FIRST signed integer, preserving a leading minus (a negative
    -- debt = credit/overpaid → must NOT become a positive "you owe" amount), and
    -- dropping thousands spaces. "Нет долга"/blank → null.
    v_amount := regexp_replace(coalesce((regexp_match(coalesce(v_chat.debts,''), '-?[0-9][0-9 ]*'))[1], ''), '\s', '', 'g');
    v_amount := nullif(v_amount, '');
    foreach spec slice 1 in array plan_spec loop
      v_cat := spec[1]; v_sub := spec[2]; v_due := spec[3]::int; v_lang := v_chat.language;

      -- Services/debt reminder only when the client actually owes.
      continue when v_cat = 'debts' and (v_amount is null or v_amount::numeric <= 0);

      select * into v_tpl from mqa_notification_templates t
      where t.category=v_cat and t.subtype=v_sub and t.active and t.language=v_lang limit 1;
      if not found then
        select * into v_tpl from mqa_notification_templates t
        where t.category=v_cat and t.subtype=v_sub and t.active and t.language='ru' limit 1;
      end if;
      continue when not found;

      v_sched := make_date(extract(year from ref_date)::int, extract(month from ref_date)::int, least(v_due,28));
      if v_sched < ref_date then v_sched := (v_sched + interval '1 month')::date; end if;
      -- Billing range for the services payment, e.g. 24.07-24.08 (accountant verifies/edits).
      v_period := to_char(ref_date,'DD.MM') || '-' || to_char((ref_date + interval '1 month')::date,'DD.MM');
      -- Reporting month for the docs request = previous month, in the chat language.
      v_midx := extract(month from (ref_date - interval '1 month'))::int;
      v_month := case v_tpl.language when 'hy' then month_hy[v_midx] when 'en' then month_en[v_midx] when 'zh' then month_en[v_midx] else month_ru[v_midx] end;

      v_text := replace(v_tpl.body, '{company}', v_company);
      v_text := replace(v_text, '{contract}', v_chat.agr_no);
      v_text := replace(v_text, '{hvhh}', coalesce(v_chat.hvhh,''));
      v_text := replace(v_text, '{amount}', coalesce(v_amount,''));
      v_text := replace(v_text, '{period}', v_period);
      v_text := replace(v_text, '{month}', coalesce(v_month,''));
      v_text := replace(v_text, '{due_day}', v_due::text);
      v_text := replace(v_text, '{client}', v_company);

      insert into mqa_planned_notifications (
        agr_no, period, category, subtype, language, scheduled_date,
        template_id, mode, requires_attachment, rendered_text, status
      )
      values (
        v_chat.agr_no,
        to_char(case when extract(day from v_sched) >= 28 then (v_sched + interval '1 month') else v_sched end,'YYYYMM'),
        v_cat, v_sub, v_tpl.language, v_sched, v_tpl.id, v_tpl.mode, v_tpl.requires_attachment, v_text, 'planned'
      )
      on conflict (agr_no, period, category, subtype) do update
        set scheduled_date=excluded.scheduled_date, language=excluded.language, template_id=excluded.template_id,
            mode=excluded.mode, requires_attachment=excluded.requires_attachment, rendered_text=excluded.rendered_text, updated_at=now()
        where mqa_planned_notifications.status = 'planned';

      planned_count := planned_count + 1;
    end loop;
  end loop;
  return planned_count;
end;
$fn$;

revoke all on function public.mqa_plan_notifications(date) from public;
