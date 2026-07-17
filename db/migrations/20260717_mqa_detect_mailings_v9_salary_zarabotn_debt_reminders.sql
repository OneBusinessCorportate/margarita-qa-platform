-- ---------------------------------------------------------------------------
-- v9: catch the standard salary рассылка «начисление ЗАРАБОТНОЙ ПЛАТЫ … не
-- производится» and the debt рассылка «НАПОМИНАЕМ о задолженности / ПРОСИМ
-- оплатить / ОПЛАТИТЕ …».
--
-- Bug (Маргарита): the platform did not auto-pull the SALARY mailing for many
-- chats (agr B-3576, B-3212, B-3371, B-3112, 992, 454 …). The standard Russian
-- template is «Сообщаем, что начисление ЗАРАБОТНОЙ ПЛАТЫ за текущий период не
-- производится …». It contains the word «заработной», NOT the substring
-- «зарплат», so the salary NOUN gate (зарплат|ведомост|зп|авансов) never
-- matched → no signal → status stayed empty and she had to mark it by hand.
-- Fix: add «заработн» to every salary noun gate. «заработной/заработная/
-- заработную» now match; the NOTIFY-done rule («сообщаем/уведомл/рассыл»,
-- guarded by neg_send) then reads the sent mailing as «Получил».
--
-- Bug (Маргарита): the DEBT mailing was often not auto-pulled. The reminder is
-- usually «НАПОМИНАЕМ о задолженности», «ПРОСИМ/ПРОСЬБА оплатить», «ОПЛАТИТЕ до
-- …» — but the debt req verb list required «напоминани» (which does NOT match
-- «напоминаем») and had no «просим/просьба/оплатите». Fix: widen the debt req
-- verbs so a real reminder registers as «1-й/2-й написал».
--
-- Mirrors the JS detector src/lib/mailings-detect.ts (KW.salary_ru gains
-- «заработн»; the RU debts/req rule gains напомина/прос(им|ьб)/оплатит/к оплате).
-- Everything else is unchanged from v8. Only the function is replaced (the 2h
-- cron from v2 keeps calling the newest version).
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
  -- "не <опц. 1-2 слова> <глагол-выполнения>" — a completion that DID NOT happen.
  neg_done constant text :=
    '\mне\M[[:space:]]+([[:alpha:]]+[[:space:]]+){0,2}(получ|пришл|прислал|подпис|сдал|сдела|сдан|подан|предостав|скинул|сброс|отправ|выслал|переслал|направ|подал|загруз|выгруз|отчита|задеклар|готов|выполн|оформ|провед)';
  -- SCOPED negation of the SENDING / notification verb only. OMITS the
  -- pure-receive verbs and the calc verb (начисл) so «зарплата не начисляется»
  -- stays done. Mirrors JS NEG_SEND_RU.
  neg_send constant text :=
    '\mне\M[[:space:]]+([[:alpha:]]+[[:space:]]+){0,2}(рассыл|разосл|разошл|уведом|сообщ|информир|напомн|отправ|выслал|переслал|направ|подал|подан|сдан|сдела|сделан|загруз|выгруз|отчита|задеклар|оформ|провед|провёл|провел|готов|выполн)';
  -- "не оплачен / не выплатил / не погашен / не закрыт" — debt still open.
  neg_paid constant text :=
    '\mне\M[[:space:]]+([[:alpha:]]+[[:space:]]+){0,2}(оплат|оплач|выплат|погас|закрыт)';
  -- Armenian negation prefix չ- covering the done/paid verb families.
  neg_hy constant text :=
    'չ(ի|ե[մսնք]|եք|կա|ստաց|ուղարկ|ներկայաց|հանձն|տրամ|վճար|մար|փակ|կատար|արվ)';
  -- SCOPED Armenian negation of the SENDING / notification verb. OMITS կատար so
  -- «… չի կատարվում» (no salary this period) stays done. Mirrors JS NEG_SEND_HY.
  neg_send_hy constant text :=
    'չ(ուղարկ|ներկայաց|հանձն|տեղեկաց|հիշեց|առաք|ցր)|չ(ի|ե[մսնք]{1,2}|կա)[[:space:]]+([^[:space:]]+[[:space:]]+){0,2}(ուղարկ|ներկայաց|հանձն|տեղեկաց|հիշեց|առաք|ցր)';
begin
  -- Cycle bounds in Yerevan local time (UTC+4, no DST): 28th of the previous
  -- month 00:00 up to the 28th of the cycle month 00:00.
  period_start := (((period_ym || '01')::date - interval '1 month' + interval '27 days')::timestamp
                   at time zone 'Asia/Yerevan');
  period_end   := (((period_ym || '01')::date + interval '27 days')::timestamp
                   at time zone 'Asia/Yerevan');

  with
  -- Extract numeric chat_id from the stored Telegram link.
  linked as (
    select c.agr_no,
           case
             when regexp_replace(c.chat_link, '^.*#', '') ~ '^-?\d+$'
             then regexp_replace(c.chat_link, '^.*#', '')::bigint
           end as chat_id
    from mqa_chats c
    where c.status = 'Active'
      and c.chat_link is not null
  ),
  -- Accountant messages in the cycle for tracked chats.
  msgs as (
    select l.agr_no,
           m.text,
           m.created_at
    from public.messages m
    join linked l on l.chat_id = m.chat_id
    where m.sender_role = 'accountant'
      and m.created_at >= period_start
      and m.created_at <  period_end
      and m.text is not null
      and length(m.text) > 3
  ),
  -- Tag each message with (category, signal_type) pairs.
  signals as (
    select distinct agr_no, created_at, sig_cat, sig_type
    from msgs
    cross join lateral (
      values
        -- ===== Russian (RU) rules =========================================
        -- main_taxes: done (NOT negated) — v8: guarded by neg_send.
        (case when text ~* '(налог|декларац|ндс|налогов)'
               and text ~* '(отправ|подал|подан|сдан|направил|загрузил|выгрузил|сдала|отправила|отчита|задеклар|сдела|оформ|готов)'
               and text !~* neg_send
              then 'main_taxes' end,
         'done'),
        -- main_taxes: neg (explicitly not sent) — v8: scoped to neg_send.
        (case when text ~* '(налог|декларац|ндс|налогов)'
               and text ~* neg_send
              then 'main_taxes' end,
         'neg'),
        -- salary: done (NOT negated). v9: noun gate gains «заработн».
        (case when text ~* '(зарплат|ведомост|заработн|\mзп\M|авансовый\s+отчет|авансов)'
               and text ~* '(получ|пришл|прислал|подпис|сдал|предоставил|скинул|сбросил|прислала|получила|пришла|передал|отправил|отправила|отправлен|отправлена|отправили|выслал|переслал|сдела|сделан|готов|выполн|оформ|провед)'
               and text !~* neg_done
              then 'salary' end,
         'done'),
        -- salary: done via NOTIFICATION sent (рассылка отправлена). v9: noun
        -- gate gains «заработн» so «начисление заработной платы … не
        -- производится» + «Сообщаем/уведомл/рассыл» reads as sent → «Получил».
        (case when text ~* '(зарплат|ведомост|заработн|\mзп\M|авансов)'
               and text ~* '(рассыл|разосл|разошл|уведомл|уведомил|уведомля|сообщаем|сообщил|информир|напоминаем|напомнил)'
               and text !~* neg_send
              then 'salary' end,
         'done'),
        -- salary: req (request). v9: noun gate gains «заработн».
        (case when text ~* '(зарплат|ведомост|заработн|\mзп\M)'
               and text ~* '(запрос|прошу|просьб|нужн|пришлит|отправьт|скиньт|передайт|пожалуйст|жду|ожида)'
              then 'salary' end,
         'req'),
        -- salary: neg (explicitly not received/done). v9: noun gate gains «заработн».
        (case when text ~* '(зарплат|ведомост|заработн|\mзп\M|авансовый\s+отчет|авансов)'
               and text ~* neg_done
              then 'salary' end,
         'neg'),
        -- salary: neg via a negated SEND. v9: noun gate gains «заработн».
        (case when text ~* '(зарплат|ведомост|заработн|\mзп\M|авансовый\s+отчет|авансов)'
               and text ~* neg_send
              then 'salary' end,
         'neg'),
        -- primary_docs: done (NOT negated)
        (case when text ~* '(первичн|первичк|акт[ыа]?\M|документ|накладн|счет-факт|счёт-факт)'
               and text ~* '(получ|пришл|прислал|сдал|предоставил|скинул|передал|прислала|получила|пришла|отправил|отправила|отправлен|отправлена|отправили|выслал|переслал|сдела|сделан|готов|выполн|оформ|провед)'
               and text !~* neg_done
              then 'primary_docs' end,
         'done'),
        -- primary_docs: req
        (case when text ~* '(первичн|первичк|акт[ыа]?\M|документ|накладн)'
               and text ~* '(запрос|прошу|просьб|нужн|пришлит|отправьт|скиньт|передайт|пожалуйст|жду|ожида)'
              then 'primary_docs' end,
         'req'),
        -- primary_docs: neg (explicitly not received/done)
        (case when text ~* '(первичн|первичк|акт[ыа]?\M|документ|накладн|счет-факт|счёт-факт)'
               and text ~* neg_done
              then 'primary_docs' end,
         'neg'),
        -- debts: paid (no debt — client paid; NOT negated)
        (case when text ~* '(долг|задолженност|задолж)'
               and text ~* '(оплатил|оплатила|оплачен|оплачена|оплачено|оплата\s+прошла|выплатил|выплатила|погашен|погасил|закрыт|закрыта|нет\s+долга|нет\s+задолж)'
               and text !~* neg_paid
              then 'debts' end,
         'paid'),
        -- debts: call (called client about debt)
        (case when text ~* '(долг|задолженност)'
               and text ~* '(позвон|звонил|звонок|обзвон|перезвон|созвон)'
              then 'debts' end,
         'call'),
        -- debts: req (wrote/messaged client about debt). v9: widened to real
        -- reminder wording — «напомина(ем)», «просим/просьба», «оплатите/к оплате»
        -- («напоминани» did not match «напоминаем», so reminders were missed).
        (case when text ~* '(долг|задолженност)'
               and text ~* '(написал|написала|напомина|уведомил|сообщил|написали|напомнил|прос(им|ьб)|оплатит[ьеё]|к\s+оплате)'
              then 'debts' end,
         'req'),

        -- ===== Armenian (HY) rules — mirror of mailings-detect.ts =========
        -- main_taxes: done (NOT negated) — ուղարկ=sent, ներկայաց=submitted
        (case when text ~* '(հարկ|ԱԱՀ|հայտ|հռչ|հաշվետ)'
               and text ~* '(ուղարկ|ներկայաց|հանձնե|բեռնե|ներբեռն)'
               and text !~* neg_hy
              then 'main_taxes' end,
         'done'),
        -- main_taxes: neg (չ- prefix)
        (case when text ~* '(հարկ|ԱԱՀ|հայտ|հռչ|հաշվետ)'
               and text ~* neg_hy
              then 'main_taxes' end,
         'neg'),
        -- salary: done (NOT negated) — աշխատավարձ=salary, ստաց=received
        (case when text ~* '(աշխատավարձ|աշխ\.?\s*վ|ա/վ|ա\.վ\.|հաշվ\.?\s*ց|ռոճիկ)'
               and text ~* '(ստաց|ուղարկ|տրամ|ստ\.)'
               and text !~* neg_hy
              then 'salary' end,
         'done'),
        -- salary: done via NOTIFICATION sent — «Տեղեկացնում ենք … աշխատավարձ …».
        (case when text ~* '(աշխատավարձ|աշխ\.?\s*վ|ա/վ|ա\.վ\.|հաշվ\.?\s*ց|ռոճիկ)'
               and text ~* '(տեղեկացն|հիշեցն)'
               and text !~* neg_send_hy
              then 'salary' end,
         'done'),
        -- salary: req — խնդրե=please/ask, կարիք=need, պե՞տք=needed?
        (case when text ~* '(աշխատավարձ|աշխ\.?\s*վ|ա/վ|ռոճիկ)'
               and text ~* '(խնդրե|կարիք|պե՞տք)'
              then 'salary' end,
         'req'),
        -- salary: neg
        (case when text ~* '(աշխատավարձ|աշխ\.?\s*վ|ա/վ|ա\.վ\.|հաշվ\.?\s*ց|ռոճիկ)'
               and text ~* neg_hy
              then 'salary' end,
         'neg'),
        -- primary_docs: done (NOT negated) — փաստաթ=document, հաշիվ=invoice
        (case when text ~* '(փաստաթ|[աՈ][կք]տ|հաշիվ|[աՈ][կք]ներ|ն[եա]ր[կք]ա)'
               and text ~* '(ստաց|ուղարկ|հանձնե|ստ\.)'
               and text !~* neg_hy
              then 'primary_docs' end,
         'done'),
        -- primary_docs: req
        (case when text ~* '(փաստաթ|[աՈ][կք]տ|հաշիվ)'
               and text ~* '(խնդրե|կարիք|պետք)'
              then 'primary_docs' end,
         'req'),
        -- primary_docs: neg
        (case when text ~* '(փաստաթ|[աՈ][կք]տ|հաշիվ|[աՈ][կք]ներ|ն[եա]ր[կք]ա)'
               and text ~* neg_hy
              then 'primary_docs' end,
         'neg'),
        -- debts: paid (NOT negated) — վճար=pay, մարե=repaid, փակե=closed.
        (case when text ~* '(պարտք|պարտաբ)'
               and text ~* '(վճար|մարե|փակե|չկա\s+պ|պարտք\s+չ)'
               and text !~* neg_hy
              then 'debts' end,
         'paid'),
        -- debts: call — զանգ=call
        (case when text ~* '(պարտք|պարտաբ)'
               and text ~* '(զանգ|զ\.)'
              then 'debts' end,
         'call'),
        -- debts: req — գր=wrote, հուշ=reminder, ծանուց=notice
        (case when text ~* '(պարտք|պարտաբ)'
               and text ~* '(գր[եէ]|հուշ|տեղեկ|ծանուց)'
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
