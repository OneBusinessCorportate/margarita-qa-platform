-- ---------------------------------------------------------------------------
-- v2: improved mqa_detect_mailings with:
--   • count-based 2nd-contact detection (Запросил 2 / 2-й написал)
--   • "Нет долга" detection from paid-debt messages
--   • reschedule to run every 2 hours (was once daily)
-- Run this after 20260622_mqa_chat_mailings.sql.
-- ---------------------------------------------------------------------------

-- Drop the v1 jobs (unschedule gracefully — ignore if they don't exist).
select cron.unschedule('mqa_detect_mailings_daily')         where exists (
  select 1 from cron.job where jobname = 'mqa_detect_mailings_daily'
);
select cron.unschedule('mqa_detect_mailings_prev_month')    where exists (
  select 1 from cron.job where jobname = 'mqa_detect_mailings_prev_month'
);

-- ---------------------------------------------------------------------------
-- Improved mqa_detect_mailings: counts signals per (chat, category, type),
-- then derives the graduated mailing status from those counts.
-- Signal types:
--   done  — completed action (taxes sent, docs/salary received)
--   req   — made a request to client (asked for docs, wrote about debt)
--   call  — made a phone call about debt
--   paid  — client confirmed debt is paid / no debt
-- ---------------------------------------------------------------------------
create or replace function public.mqa_detect_mailings(
  period_ym text default to_char(
    now() at time zone 'Asia/Yerevan', 'YYYYMM'
  )
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  period_start date;
  period_end   date;
begin
  period_start := (period_ym || '01')::date;
  period_end   := period_start + interval '1 month';

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
  -- Accountant messages in the period for tracked chats.
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
  -- Each message may emit signals for multiple categories.
  signals as (
    select agr_no, created_at, sig_cat, sig_type
    from msgs
    cross join lateral (
      values
        -- main_taxes: done
        (case when text ~* '(налог|декларац|ндс|налогов)'
               and text ~* '(отправ|подан|сдан|направил|загрузил|выгрузил|сдала|отправила)'
              then 'main_taxes' end,
         'done'),
        -- salary: done
        (case when text ~* '(зарплат|ведомост|\mзп\M|авансовый\s+отчет|авансов)'
               and text ~* '(получ|пришл|прислал|подпис|сдал|предоставил|скинул|сбросил|прислала|получила|пришла)'
              then 'salary' end,
         'done'),
        -- salary: req (request)
        (case when text ~* '(зарплат|ведомост|\mзп\M)'
               and text ~* '(запрос|прошу|просьб|нужн|пришлит|отправьт|скиньт|передайт|пожалуйст)'
              then 'salary' end,
         'req'),
        -- primary_docs: done
        (case when text ~* '(первичн|первичк|акт[ыа]?\M|документ|накладн|счет-факт|счёт-факт)'
               and text ~* '(получ|пришл|прислал|сдал|предоставил|скинул|передал|прислала|получила|пришла)'
              then 'primary_docs' end,
         'done'),
        -- primary_docs: req
        (case when text ~* '(первичн|первичк|акт[ыа]?\M|документ|накладн)'
               and text ~* '(запрос|прошу|просьб|нужн|пришлит|отправьт|скиньт|передайт|пожалуйст)'
              then 'primary_docs' end,
         'req'),
        -- debts: paid (no debt — client paid)
        (case when text ~* '(долг|задолженност|задолж)'
               and text ~* '(оплатил|оплатила|оплата\s+прошла|погашен|погасил|закрыт|закрыта|нет\s+долга|нет\s+задолж)'
              then 'debts' end,
         'paid'),
        -- debts: call (called client about debt)
        (case when text ~* '(долг|задолженност)'
               and text ~* '(позвон|звонил|звонок|обзвон|перезвон)'
              then 'debts' end,
         'call'),
        -- debts: req (wrote/messaged client about debt)
        (case when text ~* '(долг|задолженност)'
               and text ~* '(написал|написала|напоминани|уведомил|сообщил|написали|напомнил)'
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
  -- Pivot counts into (done_n, req_n, call_n, paid_n) per (agr_no, category).
  pivoted as (
    select agr_no,
           category,
           coalesce(max(case when stype = 'done' then n end), 0) as done_n,
           coalesce(max(case when stype = 'req'  then n end), 0) as req_n,
           coalesce(max(case when stype = 'call' then n end), 0) as call_n,
           coalesce(max(case when stype = 'paid' then n end), 0) as paid_n,
           greatest(
             max(case when stype = 'done' then last_at end),
             max(case when stype = 'req'  then last_at end),
             max(case when stype = 'call' then last_at end),
             max(case when stype = 'paid' then last_at end)
           ) as detected_at
    from counts
    group by agr_no, category
  ),
  -- Derive graduated mailing status from counts.
  final as (
    select agr_no,
           category,
           case category
             when 'main_taxes' then
               case when done_n >= 1 then 'Отправил' end
             when 'salary' then
               case when done_n >= 1 then 'Получил'
                    when req_n  >= 2 then 'Запросил 2, не получил'
                    when req_n  =  1 then 'Запросил 1, не получил'
               end
             when 'primary_docs' then
               case when done_n >= 1 then 'Получил'
                    when req_n  >= 2 then 'Запросил 2, не получил'
                    when req_n  =  1 then 'Запросил 1, не получил'
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

-- ---------------------------------------------------------------------------
-- Reschedule: every 2 hours. Also keep a previous-month back-fill on the 1st.
-- ---------------------------------------------------------------------------
select cron.schedule(
  'mqa_detect_mailings_2h',
  '0 */2 * * *',
  $$select public.mqa_detect_mailings();$$
);

select cron.schedule(
  'mqa_detect_mailings_prev_month',
  '30 18 1 * *',
  $$select public.mqa_detect_mailings(
    to_char(
      (now() at time zone 'Asia/Yerevan') - interval '1 month',
      'YYYYMM'
    )
  );$$
);
