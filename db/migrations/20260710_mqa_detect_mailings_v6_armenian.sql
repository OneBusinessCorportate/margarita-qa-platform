-- ---------------------------------------------------------------------------
-- v6: ARMENIAN (HY) keyword detection in the pg_cron background scan.
--
-- Bug: the every-2h cron function was Russian-only (see v5 header) — Armenian
-- рассылки were only ever detected by the app-level scan on Scoring-page load
-- (src/lib/mailings-run.ts). If nobody opened the page, HY mailings were never
-- auto-detected. On the live data this is a large gap: the current cycle has
-- 559 msgs with tax keywords, 176 salary, 336 primary-docs that the RU-only
-- scan skipped entirely.
--
-- Fix: add HY rules to the cron function, mirroring the Armenian branch of
-- src/lib/mailings-detect.ts exactly (same keyword fragments, same done/req/
-- call/paid/neg verb sets, same negation prefix չ-). Russian rules are
-- unchanged from v5. Postgres `~*` case-folds Armenian (verified: 'Աշխ…' ~*
-- 'աշխ…' → true), so sentence-start capitals match without extra handling.
--
-- Also: the `signals` CTE now selects DISTINCT (agr_no, created_at, category,
-- type) so a single message that happens to match both an RU and an HY rule
-- for the same (category, type) is counted once — mirroring the per-message
-- dedup that detectAllSignals() does with its `seen` set. Without this, a
-- bilingual message could inflate a `req` count (1 → 2) and over-escalate the
-- derived status.
--
-- Note — faithful mirror of a JS quirk: for debts/paid the HY positive phrases
-- «չկա պ…» / «պարտք չ…» ("no debt") contain the negation particle չ, so the
-- `!~* neg_hy` guard suppresses them, exactly as `none: [NEG_HY]` does in the
-- JS rule. HY debts/paid therefore fires on վճար/մարե/փակե, not on the
-- "no debt" phrasing. Kept identical to JS on purpose — SQL and JS must agree.
--
-- Cycle bounds / rollover / status derivation unchanged from v5.
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
  -- "не оплачен / не выплатил / не погашен / не закрыт" — debt still open.
  neg_paid constant text :=
    '\mне\M[[:space:]]+([[:alpha:]]+[[:space:]]+){0,2}(оплат|оплач|выплат|погас|закрыт)';
  -- Armenian negation prefix չ- covering the done/paid verb families.
  neg_hy constant text :=
    'չ(ի|ե[մսնք]|եք|կա|ստաց|ուղարկ|ներկայաց|հանձն|տրամ|վճար|մար|փակ|կատար|արվ)';
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
  -- Each message may emit signals for multiple categories. DISTINCT dedups a
  -- message that matches both an RU and an HY rule for the same (cat, type).
  signals as (
    select distinct agr_no, created_at, sig_cat, sig_type
    from msgs
    cross join lateral (
      values
        -- ===== Russian (RU) rules — unchanged from v5 =====================
        -- main_taxes: done (NOT negated)
        (case when text ~* '(налог|декларац|ндс|налогов)'
               and text ~* '(отправ|подал|подан|сдан|направил|загрузил|выгрузил|сдала|отправила|отчита|задеклар|сдела|оформ|готов)'
               and text !~* neg_done
              then 'main_taxes' end,
         'done'),
        -- main_taxes: neg (explicitly not sent)
        (case when text ~* '(налог|декларац|ндс|налогов)'
               and text ~* neg_done
              then 'main_taxes' end,
         'neg'),
        -- salary: done (NOT negated)
        (case when text ~* '(зарплат|ведомост|\mзп\M|авансовый\s+отчет|авансов)'
               and text ~* '(получ|пришл|прислал|подпис|сдал|предоставил|скинул|сбросил|прислала|получила|пришла|передал|отправил|отправила|отправлен|отправлена|отправили|выслал|переслал|сдела|сделан|готов|выполн|оформ|провед)'
               and text !~* neg_done
              then 'salary' end,
         'done'),
        -- salary: req (request)
        (case when text ~* '(зарплат|ведомост|\mзп\M)'
               and text ~* '(запрос|прошу|просьб|нужн|пришлит|отправьт|скиньт|передайт|пожалуйст|жду|ожида)'
              then 'salary' end,
         'req'),
        -- salary: neg (explicitly not received/done)
        (case when text ~* '(зарплат|ведомост|\mзп\M|авансовый\s+отчет|авансов)'
               and text ~* neg_done
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
        -- debts: req (wrote/messaged client about debt)
        (case when text ~* '(долг|задолженност)'
               and text ~* '(написал|написала|напоминани|уведомил|сообщил|написали|напомнил)'
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
        -- (չկա պ… / պարտք չ… self-suppress via neg_hy — mirrors the JS rule.)
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
  -- Count signals per (agr_no, category, type) and track latest message timestamp.
  counts as (
    select agr_no,
           sig_cat as category,
           sig_type as stype,
           count(*)::int as n,
           max(created_at) as last_at
    from signals
    group by agr_no, sig_cat, sig_type
  ),
  -- Pivot counts into (done_n, req_n, call_n, paid_n, neg_n) per (agr_no, category).
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
  -- Derive graduated mailing status from counts. Done wins; an explicit
  -- negative with no completion surfaces a "not completed" status.
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
