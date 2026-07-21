-- ---------------------------------------------------------------------------
-- v12: SOFT catch-all so EVERY рассылка type is identified automatically
-- (Маргарита: рассылка по налогам / зарплате / документам / долгам часто НЕ
-- подтягивается и приходится отмечать вручную).
--
-- WHAT changed vs v11 (kept in 1:1 parity with src/lib/mailings-detect.ts):
--   Until now a message had to match BOTH a category keyword AND a specific
--   action-verb list. Wording variants missing from those verb lists
--   («оповещаем», «извещаем», «информационное письмо», «напоминание …») were
--   silently dropped, and primary_docs had NO generic notification catch at all.
--
--   New `mailing_ru` / `mailing_hy` marker = a broad, generic mailing /
--   notification word. A category keyword next to it is enough to identify that
--   category's рассылка, WITHOUT a specific verb:
--     • main_taxes + mailing word → 'done'  (taxes are SENT → «Отправил»),
--     • salary     + mailing word → 'done'  (notification sent → «Получил»),
--     • primary_docs + mailing word → 'req' (a docs рассылка asks the client),
--     • debts      + mailing word → 'req'   (a debt рассылка is a reminder).
--
--   Guards keep it honest:
--     • taxes/salary soft-done are guarded by neg_send (RU) / neg_send_hy (HY),
--       so «рассылку … не отправил / չենք տեղեկացրել» never counts as done;
--     • taxes soft-done is also guarded by svc_pay (service-payment reminder is
--       a debts рассылка, not a tax one);
--     • the welcome-template guard is unchanged — the app-layer classifier
--       strips done/paid from onboarding messages, so a mailing word inside a
--       welcome message can never become «Отправил»/«Получил».
--
-- Idempotent: `create or replace`. Everything else is byte-identical to v11.
-- NOTE: this function canonically lives here (repo #1); the kk-accountants copy
-- must be kept in sync.
-- ---------------------------------------------------------------------------

create or replace function public.mqa_detect_mailings(
  period_ym text default to_char(
    case
      when extract(day from now() at time zone 'Asia/Yerevan') >= 28
      then (now() at time zone 'Asia/Yerevan') + interval '1 month'
      else (now() at time zone 'Asia/Yerevan')
    end,
    'YYYYMM'
  )
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  period_start timestamptz;
  period_end   timestamptz;
  neg_done constant text :=
    '\mне\M[[:space:]]+([[:alpha:]]+[[:space:]]+){0,2}(получ|пришл|прислал|подпис|сдал|сдела|сдан|подан|предостав|скинул|сброс|отправ|выслал|переслал|направ|подал|загруз|выгруз|отчита|задеклар|готов|выполн|оформ|провед)';
  -- v11: + перечисл/перевел/перевёл/переведен/простав/произвел/произвед, чтобы
  -- «зарплату не перечислил / не перевёл / не проставил» оставались НЕ done.
  neg_send constant text :=
    '\mне\M[[:space:]]+([[:alpha:]]+[[:space:]]+){0,2}(рассыл|разосл|разошл|уведом|сообщ|информир|напомн|отправ|выслал|переслал|направ|перечисл|перевел|перевёл|переведен|простав|произвел|произвед|подал|подан|сдан|сдела|сделан|загруз|выгруз|отчита|задеклар|оформ|провед|провёл|провел|готов|выполн)';
  neg_paid constant text :=
    '\mне\M[[:space:]]+([[:alpha:]]+[[:space:]]+){0,2}(оплат|оплач|выплат|погас|закрыт)';
  neg_hy constant text :=
    'չ(ի|ե[մսնք]|եք|կա|ստաց|ուղարկ|ներկայաց|հանձն|տրամ|վճար|մար|փակ|կատար|արվ)';
  neg_send_hy constant text :=
    'չ(ուղարկ|ներկայաց|հանձն|տեղեկաց|հիշեց|առաք|ցր)|չ(ի|ե[մսնք]{1,2}|կա)[[:space:]]+([^[:space:]]+[[:space:]]+){0,2}(ուղարկ|ներկայաց|հանձն|տեղեկաց|հիշեց|առաք|ցր)';
  -- v11: service-payment reminder (оплата услуг до 5 числа) — БЕЗ слова «долг».
  -- Побудительная/напоминательная форма + «услуг»/назначение платежа. Даёт
  -- debts:req. (Приветственный шаблон «Срок оплаты услуг:» НЕ срабатывает.)
  svc_pay constant text :=
    '(оплатите[[:space:]]+(бухгалтерск|услуг|наши)|произвести[[:space:]]+оплату|о[[:space:]]+необходимости[[:space:]]+(произвести[[:space:]]+)?оплат|напоминаем[^.!?]{0,40}оплат|просим[[:space:]]+оплат|оплат[[:alpha:]]*[[:space:]]+бухгалтерск[[:alpha:]]*[[:space:]]+услуг|payment[[:space:]]+for[[:space:]]+account(ant|ing)[[:space:]]+servic|pay[[:space:]]+for[[:space:]]+account(ing|ant)[[:space:]]+servic|վճարումը[[:space:]]+կատար|կատարեք[[:space:]]+հաշվապահական[[:space:]]+ծառայ|հաշվապահական[[:space:]]+ծառայ[[:alpha:]]*[[:space:]]+վճար)';
  -- v12: generic mailing/notification marker (SOFT catch-all). A category
  -- keyword next to one of these words IS that category's рассылка, even without
  -- a specific action verb. Mirrors MAILING_RU / MAILING_HY in mailings-detect.ts.
  mailing_ru constant text :=
    '(рассыл|разосл|разошл|уведомл|уведомил|уведомля|напоминани|напоминаем|напоминаю|напомнил|напомин|информир|информацион|оповещ|извещ|оповестил|известил)';
  mailing_hy constant text :=
    '(տեղեկացն|տեղեկացր|հիշեցն|ծանուց|իրազեկ)';
begin
  period_start := (((period_ym || '01')::date - interval '1 month' + interval '27 days')::timestamp
                   at time zone 'Asia/Yerevan');
  period_end   := (((period_ym || '01')::date + interval '27 days')::timestamp
                   at time zone 'Asia/Yerevan');

  with
  linked as (
    select c.agr_no,
           mqa_norm_tg_id(regexp_replace(c.chat_link, '^.*#', '')) as chat_key
    from mqa_chats c
    where c.status = 'Active'
      and c.chat_link is not null
      and regexp_replace(c.chat_link, '^.*#', '') ~ '^-?\d+$'
  ),
  msgs as (
    select l.agr_no,
           m.text,
           m.created_at
    from public.messages m
    join linked l on l.chat_key = mqa_norm_tg_id(m.chat_id::text)
    where m.sender_role = 'accountant'
      and m.created_at >= period_start
      and m.created_at <  period_end
      and m.text is not null
      and length(m.text) > 3
  ),
  signals as (
    select distinct agr_no, created_at, sig_cat, sig_type
    from msgs
    cross join lateral (
      values
        (case when text ~* '(налог|декларац|ндс|налогов)'
               and text ~* '(отправ|подал|подан|сдан|направил|загрузил|выгрузил|сдала|отправила|отчита|задеклар|сдела|оформ|готов)'
               and text !~* neg_send
               and text !~* svc_pay
              then 'main_taxes' end,
         'done'),
        (case when text ~* '(налог|декларац|ндс|налогов)'
               and text ~* neg_send
              then 'main_taxes' end,
         'neg'),
        -- salary done — v11: + send verbs (направ/перечисл/перевёл/простав/
        -- произвел/произвед) for the до-10 «Направляю таблицу … проставлены в
        -- банке / перечислил / выплаты произведены» template.
        (case when text ~* '(зарплат|ведомост|заработн|\mзп\M|авансовый\s+отчет|авансов)'
               and text ~* '(получ|пришл|прислал|подпис|сдал|предоставил|скинул|сбросил|прислала|получила|пришла|передал|отправил|отправила|отправлен|отправлена|отправили|выслал|переслал|сдела|сделан|готов|выполн|оформ|провед|направ|перечисл|перевел|перевёл|переведен|простав|произвел|произвед)'
               and text !~* neg_done
               and text !~* neg_send
              then 'salary' end,
         'done'),
        -- salary notify — v11: + 1st-person сообща/сообщу/напоминаю/направля.
        (case when text ~* '(зарплат|ведомост|заработн|\mзп\M|авансов)'
               and text ~* '(рассыл|разосл|разошл|уведомл|уведомил|уведомля|сообща|сообщил|сообщу|информир|напоминаем|напоминаю|напомнил|направля)'
               and text !~* neg_send
              then 'salary' end,
         'done'),
        (case when text ~* '(зарплат|ведомост|заработн|\mзп\M)'
               and text ~* '(запрос|прошу|просим|просят|просьб|нужн|пришлит|отправьт|скиньт|передайт|предоставьт|пожалуйст|жду|ожида)'
              then 'salary' end,
         'req'),
        (case when text ~* '(зарплат|ведомост|заработн|\mзп\M|авансовый\s+отчет|авансов)'
               and text ~* neg_done
              then 'salary' end,
         'neg'),
        (case when text ~* '(зарплат|ведомост|заработн|\mзп\M|авансовый\s+отчет|авансов)'
               and text ~* neg_send
              then 'salary' end,
         'neg'),
        (case when text ~* '(первичн|первичк|акт[ыа]?\M|документ|накладн|счет-факт|счёт-факт)'
               and text ~* '(получ|пришл|прислал|сдал|предоставил|скинул|передал|прислала|получила|пришла|отправил|отправила|отправлен|отправлена|отправили|выслал|переслал|сдела|сделан|готов|выполн|оформ|провед)'
               and text !~* neg_done
              then 'primary_docs' end,
         'done'),
        (case when text ~* '(первичн|первичк|акт[ыа]?\M|документ|накладн)'
               and text ~* '(запрос|прошу|просим|просят|просьб|нужн|пришлит|отправьт|скиньт|передайт|предоставьт|пожалуйст|жду|ожида)'
              then 'primary_docs' end,
         'req'),
        (case when text ~* '(первичн|первичк|акт[ыа]?\M|документ|накладн|счет-факт|счёт-факт)'
               and text ~* neg_done
              then 'primary_docs' end,
         'neg'),
        (case when text ~* '(долг|задолженност|задолж)'
               and text ~* '(оплатил|оплатила|оплачен|оплачена|оплачено|оплата\s+прошла|выплатил|выплатила|погашен|погасил|закрыт|закрыта|нет\s+долга|нет\s+задолж)'
               and text !~* neg_paid
              then 'debts' end,
         'paid'),
        (case when text ~* '(долг|задолженност)'
               and text ~* '(позвон|звонил|звонок|обзвон|перезвон|созвон)'
              then 'debts' end,
         'call'),
        (case when text ~* '(долг|задолженност|задолж)'
               and text ~* '(напис|напомн|напомин|уведом|сообщ|информир|прос(им|ьб|ит)|оплатит|оплатите|погасит|к\s+оплате|рассыл|разосл|разошл)'
              then 'debts' end,
         'req'),
        -- v11: service-payment reminder (до 5 числа) — debts:req WITHOUT «долг».
        (case when text ~* svc_pay
              then 'debts' end,
         'req'),

        -- v12: SOFT catch-all (RU) — a category keyword + any generic mailing
        -- word is enough. taxes/salary → done (guarded by neg_send + svc_pay for
        -- taxes); primary_docs/debts → req. Guarantees every type is identified.
        (case when text ~* '(налог|декларац|ндс|налогов)'
               and text ~* mailing_ru
               and text !~* neg_send
               and text !~* svc_pay
              then 'main_taxes' end,
         'done'),
        (case when text ~* '(зарплат|зарплн|заработн|ведомост|\mзп\M|авансовый\s+отчет|авансов)'
               and text ~* mailing_ru
               and text !~* neg_send
              then 'salary' end,
         'done'),
        (case when text ~* '(первичн|первичк|акт[ыа]?\M|документ|накладн|счет-факт|счёт-факт)'
               and text ~* mailing_ru
               and text !~* neg_done
              then 'primary_docs' end,
         'req'),
        (case when text ~* '(долг|задолженност|задолж|недоимк)'
               and text ~* mailing_ru
              then 'debts' end,
         'req'),

        (case when text ~* '(հարկ|ԱԱՀ|հայտ|հռչ|հաշվետ)'
               and text ~* '(ուղարկ|ներկայաց|հանձնե|բեռնե|ներբեռն)'
               and text !~* neg_hy
              then 'main_taxes' end,
         'done'),
        (case when text ~* '(հարկ|ԱԱՀ|հայտ|հռչ|հաշվետ)'
               and text ~* neg_hy
              then 'main_taxes' end,
         'neg'),
        (case when text ~* '(աշխատավարձ|աշխ\.?\s*վ|ա/վ|ա\.վ\.|հաշվ\.?\s*ց|ռոճիկ)'
               and text ~* '(ստաց|ուղարկ|տրամ|ստ\.)'
               and text !~* neg_hy
              then 'salary' end,
         'done'),
        (case when text ~* '(աշխատավարձ|աշխ\.?\s*վ|ա/վ|ա\.վ\.|հաշվ\.?\s*ց|ռոճիկ)'
               and text ~* '(տեղեկացն|հիշեցն)'
               and text !~* neg_send_hy
              then 'salary' end,
         'done'),
        (case when text ~* '(աշխատավարձ|աշխ\.?\s*վ|ա/վ|ռոճիկ)'
               and text ~* '(խնդրե|կարիք|պե՞տք)'
              then 'salary' end,
         'req'),
        (case when text ~* '(աշխատավարձ|աշխ\.?\s*վ|ա/վ|ա\.վ\.|հաշվ\.?\s*ց|ռոճիկ)'
               and text ~* neg_hy
              then 'salary' end,
         'neg'),
        (case when text ~* '(փաստաթ|[աՈ][կք]տ|հաշիվ|[աՈ][կք]ներ|ն[եա]ր[կք]ա)'
               and text ~* '(ստաց|ուղարկ|հանձնե|ստ\.)'
               and text !~* neg_hy
              then 'primary_docs' end,
         'done'),
        (case when text ~* '(փաստաթ|[աՈ][կք]տ|հաշիվ)'
               and text ~* '(խնդրե|կարիք|պետք)'
              then 'primary_docs' end,
         'req'),
        (case when text ~* '(փաստաթ|[աՈ][կք]տ|հաշիվ|[աՈ][կք]ներ|ն[եա]ր[կք]ա)'
               and text ~* neg_hy
              then 'primary_docs' end,
         'neg'),
        (case when text ~* '(պարտք|պարտաբ)'
               and text ~* '(վճար|մարե|փակե|չկա\s+պ|պարտք\s+չ)'
               and text !~* neg_hy
              then 'debts' end,
         'paid'),
        (case when text ~* '(պարտք|պարտաբ)'
               and text ~* '(զանգ|զ\.)'
              then 'debts' end,
         'call'),
        (case when text ~* '(պարտք|պարտաբ)'
               and text ~* '(գր[եէ]|հուշ|տեղեկ|ծանուց)'
              then 'debts' end,
         'req'),

        -- v12: SOFT catch-all (HY) — mirror of the RU soft rules. taxes/salary →
        -- done (guarded by neg_send_hy); primary_docs/debts → req.
        (case when text ~* '(հարկ|ԱԱՀ|հայտ|հռչ|հաշվետ)'
               and text ~* mailing_hy
               and text !~* neg_send_hy
              then 'main_taxes' end,
         'done'),
        (case when text ~* '(աշխատավարձ|աշխ\.?\s*վ|ա/վ|ա\.վ\.|հաշվ\.?\s*ց|ռոճիկ)'
               and text ~* mailing_hy
               and text !~* neg_send_hy
              then 'salary' end,
         'done'),
        (case when text ~* '(փաստաթ|[աՈ][կք]տ|հաշիվ|[աՈ][կք]ներ|ն[եա]ր[կք]ա)'
               and text ~* mailing_hy
               and text !~* neg_hy
              then 'primary_docs' end,
         'req'),
        (case when text ~* '(պարտք|պարտաբ)'
               and text ~* mailing_hy
              then 'debts' end,
         'req')
    ) t(sig_cat, sig_type)
    where sig_cat is not null
  ),
  counts as (
    select agr_no,
           sig_cat as category,
           sig_type as stype,
           count(*)::int as n,
           max(created_at) as last_at
    from signals
    group by agr_no, sig_cat, sig_type
  ),
  pivoted as (
    select agr_no,
           category,
           coalesce(max(case when stype = 'done' then n end), 0) as done_n,
           coalesce(max(case when stype = 'req'  then n end), 0) as req_n,
           coalesce(max(case when stype = 'call' then n end), 0) as call_n,
           coalesce(max(case when stype = 'paid' then n end), 0) as paid_n,
           coalesce(max(case when stype = 'neg'  then n end), 0) as neg_n,
           greatest(
             max(case when stype = 'done' then last_at end),
             max(case when stype = 'req'  then last_at end),
             max(case when stype = 'call' then last_at end),
             max(case when stype = 'paid' then last_at end),
             max(case when stype = 'neg'  then last_at end)
           ) as detected_at
    from counts
    group by agr_no, category
  ),
  final as (
    select agr_no,
           category,
           case category
             when 'main_taxes' then
               case when done_n >= 1 then 'Отправил'
                    when neg_n  >= 1 then 'Не отправил'
               end
             when 'salary' then
               case when done_n >= 1 then 'Получил'
                    when req_n  >= 2 then 'Запросил 2, не получил'
                    when req_n  =  1 then 'Запросил 1, не получил'
                    when neg_n  >= 1 then 'Запросил 1, не получил'
               end
             when 'primary_docs' then
               case when done_n >= 1 then 'Получил'
                    when req_n  >= 2 then 'Запросил 2, не получил'
                    when req_n  =  1 then 'Запросил 1, не получил'
                    when neg_n  >= 1 then 'Запросил 1, не получил'
               end
             when 'debts' then
               case when paid_n >= 1 then 'Нет долга'
                    when call_n >= 1 then '1-й позвонил'
                    when req_n  >= 2 then '2-й написал'
                    when req_n  =  1 then '1-й написал'
               end
           end as status,
           detected_at
    from pivoted
  )
  insert into mqa_chat_mailings
         (agr_no, period, category, status, source, detected_at, updated_at)
  select  agr_no, period_ym, category, status, 'telegram', detected_at, now()
  from    final
  where   status is not null
  on conflict (agr_no, period, category) do update
    set status      = excluded.status,
        detected_at = excluded.detected_at,
        updated_at  = now()
    where mqa_chat_mailings.source <> 'manual';
end;
$fn$;
