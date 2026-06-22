-- ---------------------------------------------------------------------------
-- mqa_chat_mailings: one row per (chat, period, category) storing the
-- auto-detected or manually-confirmed mailing status for that month.
--
-- Source 'telegram' = detected from message scan (overwritten on re-scan).
-- Source 'manual'   = Margarita confirmed it in the UI (never overwritten by
--                     auto-detection).
-- ---------------------------------------------------------------------------

create table if not exists mqa_chat_mailings (
  agr_no       text not null references mqa_chats(agr_no),
  period       text not null,                   -- YYYYMM e.g. '202606'
  category     text not null,                   -- main_taxes/salary/primary_docs/debts
  status       text not null,                   -- mailing status string
  source       text not null default 'telegram',-- 'telegram' | 'manual'
  confirmed    boolean not null default false,
  confirmed_by text,
  confirmed_at timestamptz,
  detected_at  timestamptz,                     -- timestamp of the triggering message
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (agr_no, period, category)
);

alter table mqa_chat_mailings enable row level security;

create index if not exists mqa_chat_mailings_period_idx on mqa_chat_mailings (period);
create index if not exists mqa_chat_mailings_agr_idx   on mqa_chat_mailings (agr_no);

-- ---------------------------------------------------------------------------
-- mqa_detect_mailings(period_ym)
--
-- Scans public.messages for accountant messages in `period_ym` (default:
-- current Yerevan month), classifies them by mailing category using regex
-- keyword rules, and upserts the best-detected status per (chat, category)
-- into mqa_chat_mailings. Rows already confirmed manually (source = 'manual')
-- are never overwritten.
--
-- Scheduling: run daily at 22:00 Yerevan (= 18:00 UTC) via pg_cron so that
-- by end-of-day the scoring form has fresh auto-fill for all four mailings.
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
  -- Extract numeric chat_id from the stored web.telegram.org link.
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
  -- Classify each message against keyword rules (each message may produce
  -- signals for multiple categories). Priority encodes "best achievable
  -- status" — a message with Получил wins over one with Запросил within
  -- the same month.
  signals as (
    select agr_no, created_at,
      -- main_taxes ----------------------------------------------------------
      case
        when text ~* '(налог|декларац|ндс|налогов)'
         and text ~* '(отправ|подан|сдан|направил|загрузил|выгрузил|сдала|отправила)'
        then 'main_taxes:20:Отправил'
      end as s_taxes,
      -- salary ---------------------------------------------------------------
      case
        when text ~* '(зарплат|ведомост|\mзп\M|авансовый отчет|авансов)'
         and text ~* '(получ|пришл|прислал|подпис|сдал|предоставил|скинул|сбросил|прислала|получила|пришла)'
        then 'salary:20:Получил'
        when text ~* '(зарплат|ведомост|\mзп\M)'
         and text ~* '(запрос|прошу|просьб|нужн|пришлит|отправьт|скиньт|передайт|пожалуйст)'
        then 'salary:10:Запросил 1, не получил'
      end as s_salary,
      -- primary_docs ---------------------------------------------------------
      case
        when text ~* '(первичн|первичк|акт[ыа]?\M|документ|накладн|счет-факт|счёт-факт)'
         and text ~* '(получ|пришл|прислал|сдал|предоставил|скинул|передал|прислала|получила|пришла)'
        then 'primary_docs:20:Получил'
        when text ~* '(первичн|первичк|акт[ыа]?\M|документ|накладн)'
         and text ~* '(запрос|прошу|просьб|нужн|пришлит|отправьт|скиньт|передайт|пожалуйст)'
        then 'primary_docs:10:Запросил 1, не получил'
      end as s_docs,
      -- debts ----------------------------------------------------------------
      case
        when text ~* '(долг|задолженност)'
         and text ~* '(позвон|звонил|звонок|обзвон|перезвон)'
        then 'debts:20:1-й позвонил'
        when text ~* '(долг|задолженност)'
         and text ~* '(написал|написала|напоминани|уведомил|сообщил|написали|напомнил|написала)'
        then 'debts:10:1-й написал'
      end as s_debts
    from msgs
  ),
  -- Flatten to individual (agr_no, category, priority, status, created_at).
  flat as (
    select agr_no,
           split_part(sig, ':', 1) as category,
           split_part(sig, ':', 2)::int as prio,
           split_part(sig, ':', 3) as status,
           created_at
    from signals
    cross join lateral (
      values (s_taxes), (s_salary), (s_docs), (s_debts)
    ) t(sig)
    where sig is not null
  ),
  -- Per (agr_no, category): keep highest-priority status, tie-break by latest message.
  best as (
    select distinct on (agr_no, category)
           agr_no, category, status, created_at
    from flat
    order by agr_no, category, prio desc, created_at desc
  )
  insert into mqa_chat_mailings
         (agr_no, period, category, status, source, detected_at, updated_at)
  select  agr_no, period_ym, category, status, 'telegram', created_at, now()
  from    best
  on conflict (agr_no, period, category) do update
    set status      = excluded.status,
        detected_at = excluded.detected_at,
        updated_at  = now()
    where mqa_chat_mailings.source <> 'manual';
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Schedule: every day at 18:00 UTC = 22:00 Yerevan (UTC+4).
-- Also scan the previous month on the 1st of each new month (catches late
-- messages that arrived after yesterday's job but before month-end).
-- ---------------------------------------------------------------------------
select cron.schedule(
  'mqa_detect_mailings_daily',
  '0 18 * * *',
  $$select public.mqa_detect_mailings();$$
);

-- On the 1st, also back-fill the previous month.
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
