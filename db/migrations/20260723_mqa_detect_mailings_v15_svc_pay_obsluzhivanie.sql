-- ---------------------------------------------------------------------------
-- mqa_detect_mailings v15 — рассылка по оплате/долгам без слова «услуги».
--
-- Причина: штатное напоминание об оплате иногда звучит как «Необходимо оплатить
-- … стоимость бухгалтерского ОБСЛУЖИВАНИЯ» / «оплата бухгалтерского
-- обслуживания» (без «услуг»), и между «оплатить» и «бухгалтерск…» стоят слова
-- («только стоимость»). Прежний svc_pay требовал соседства «оплат … бухгалтерск
-- … услуг», поэтому такой текст не давал debts→'req' и рассылка по долгу не
-- подтягивалась (Маргарита: «рассылка по долгам не подтягивается, отмечаю
-- вручную»; примеры-чаты B-4293/B-4611 и подобные).
--
-- Что делает v15: расширяет ТОЛЬКО константу svc_pay —
--   • «оплат… [до 3 слов] бухгалтерск… (услуг|обслуживани)»;
--   • «стоимость бухгалтерского обслуживания»;
--   • арм. «հաշվապահական (ծառայ|սպասարկ)… վճար».
-- Всё остальное байт-в-байт как v14. Строго аддитивно: новые формы лишь ДОБАВЛЯЮТ
-- срабатывания debts→'req', ручные отметки и «Нет долга»/оплачено не трогаются.
-- Держим в паритете с src/lib/mailings-detect.ts (SVC_PAY_REMINDER).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mqa_detect_mailings(period_ym text DEFAULT to_char(CASE WHEN (EXTRACT(day FROM (now() AT TIME ZONE 'Asia/Yerevan'::text)) >= (28)::numeric) THEN ((now() AT TIME ZONE 'Asia/Yerevan'::text) + '1 mon'::interval) ELSE (now() AT TIME ZONE 'Asia/Yerevan'::text) END, 'YYYYMM'::text))
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  period_start timestamptz;
  period_end   timestamptz;
  neg_done constant text :=
    '\mне\M[[:space:]]+([[:alpha:]]+[[:space:]]+){0,2}(получ|пришл|прислал|подпис|сдал|сдела|сдан|подан|предостав|скинул|сброс|отправ|выслал|переслал|направ|подал|загруз|выгруз|отчита|задеклар|готов|выполн|оформ|провед)';
  neg_send constant text :=
    '\mне\M[[:space:]]+([[:alpha:]]+[[:space:]]+){0,2}(рассыл|разосл|разошл|уведом|сообщ|информир|напомн|отправ|выслал|переслал|направ|перечисл|перевел|перевёл|переведен|простав|произвел|произвед|подал|подан|сдан|сдела|сделан|загруз|выгруз|отчита|задеклар|оформ|провед|провёл|провел|готов|выполн)';
  neg_paid constant text :=
    '\mне\M[[:space:]]+([[:alpha:]]+[[:space:]]+){0,2}(оплат|оплач|выплат|погас|закрыт)';
  neg_hy constant text :=
    'չ(ի|ե[մսնք]|եք|կա|ստաց|ուղարկ|ներկայաց|հանձն|տրամ|վճար|մար|փակ|կատար|արվ)';
  neg_send_hy constant text :=
    'չ(ուղարկ|ներկայաց|հանձն|տեղեկաց|հիշեց|առաք|ցր)|չ(ի|ե[մսնք]{1,2}|կա)[[:space:]]+([^[:space:]]+[[:space:]]+){0,2}(ուղարկ|ներկայաց|հանձն|տեղեկաց|հիշեց|առաք|ցր)';
  -- v15: + «оплат… [до 3 слов] бухгалтерск… (услуг|обслуживани)», «стоимость
  -- бухгалтерского обслуживания», арм. «հաշվապահական (ծառայ|սպասարկ)… վճар».
  svc_pay constant text :=
    '(оплатите[[:space:]]+(бухгалтерск|услуг|наши)|произвести[[:space:]]+оплату|о[[:space:]]+необходимости[[:space:]]+(произвести[[:space:]]+)?оплат|напоминаем[^.!?]{0,40}оплат|просим[[:space:]]+оплат|оплат[[:alpha:]]*[[:space:]]+([[:alpha:]]+[[:space:]]+){0,3}бухгалтерск[[:alpha:]]*[[:space:]]+(услуг|обслуживани)|стоимост[[:alpha:]]*[[:space:]]+бухгалтерск[[:alpha:]]*[[:space:]]+обслуживани|payment[[:space:]]+for[[:space:]]+account(ant|ing)[[:space:]]+servic|pay[[:space:]]+for[[:space:]]+account(ing|ant)[[:space:]]+servic|վճարումը[[:space:]]+կատար|կատարեք[[:space:]]+հաշվապահական[[:space:]]+ծառայ|հաշվապահական[[:space:]]+(ծառայ|սպասարկ)[[:alpha:]]*[[:space:]]+վճար)';
  -- v13: «мягкий» шаблон рассылки по долгу/оплате БЕЗ слова «долг».
  debt_soft_ru constant text :=
    '(взыскан|неуплач|просроч|недоимк|к[[:space:]]+уплате|последн[[:alpha:]]+[[:space:]]+день[^.!?]{0,25}оплат|оплат[[:alpha:]]*[^.!?]{0,20}(до[[:space:]]+[0-9]|до[[:space:]]+установленн|срок)|напоминаем[^.!?]{0,40}(оплат|погас|задолж)|просим[^.!?]{0,30}(погас|оплат[[:alpha:]]*[[:space:]]+задолж))';
  debt_soft_hy constant text :=
    '(գանձ|չվճար|վճար[[:alpha:]]*[[:space:]]+մինչև|ժամկետ[^։.!?]{0,20}վճար|վճար[^։.!?]{0,20}ժամկետ)';
  -- v14: шаблон УВЕДОМЛЕНИЯ о взыскании/неуплате — это напоминание по долгу,
  -- а НЕ подтверждение оплаты; такой текст не должен давать «Нет долга».
  debt_notice constant text :=
    '(взыскан|неуплач|просроч|порядок[[:space:]]+взыскан)';
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
        (case when text ~* '(зарплат|ведомост|заработн|\mзп\M|авансовый\s+отчет|авансов)'
               and text ~* '(получ|пришл|прислал|подпис|сдал|предоставил|скинул|сбросил|прислала|получила|пришла|передал|отправил|отправила|отправлен|отправлена|отправили|выслал|переслал|сдела|сделан|готов|выполн|оформ|провед|направ|перечисл|перевел|перевёл|переведен|простав|произвел|произвед)'
               and text !~* neg_done
               and text !~* neg_send
              then 'salary' end,
         'done'),
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
               and text !~* debt_notice
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
        (case when text ~* svc_pay
              then 'debts' end,
         'req'),
        -- v13: мягкий сигнал рассылки по долгу/оплате БЕЗ слова «долг».
        (case when text ~* debt_soft_ru
               and text !~* neg_paid
               and text !~* neg_send
              then 'debts' end,
         'req'),

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
        -- v13: мягкий арм. сигнал рассылки по долгу/взысканию/оплате.
        (case when text ~* debt_soft_hy
               and text !~* neg_hy
              then 'debts' end,
         'req'),

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
$function$;
