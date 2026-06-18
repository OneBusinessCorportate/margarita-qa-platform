-- Per-day chat activity so the scoring "day view" shows EVERY chat active on a
-- given day — not just chats whose MOST RECENT activity was that day.
--
-- Root cause this fixes
-- ---------------------
-- mqa_chats stores a single last_activity_date (the chat's LATEST active day).
-- The scoring day view membership was keyed off that, so a chat active on the
-- 16th AND the 17th only appeared under the 17th. Reviewing an earlier day
-- therefore hid 30–60% of that day's genuinely-active chats ("not all active
-- chats are visible"). The messages table has per-message timestamps, so we
-- materialize (chat, day) activity and let the day view key off that instead.
--
-- Idempotent: safe to re-run.

create table if not exists mqa_chat_activity (
  agr_no           text not null,
  active_date      date not null,
  last_at          timestamptz,
  last_sender_role text,
  primary key (agr_no, active_date)
);
create index if not exists mqa_chat_activity_date_idx on mqa_chat_activity (active_date);

-- Link mqa_chats -> live chat id (embedded in chat_link after '#'), then record
-- one row per (contract, active day). Real message days come from `messages`;
-- chats the message store hasn't captured still get their single known active
-- day from the live feed's last_seen_at so nothing regresses.
create or replace function public.mqa_refresh_chat_activity()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  with linked as (
    select m.agr_no,
           case when regexp_replace(m.chat_link, '^.*#', '') ~ '^-?\d+$'
                then regexp_replace(m.chat_link, '^.*#', '')::bigint
           end as chat_id
    from mqa_chats m
  ),
  per_day as (
    select l.agr_no,
           (msg.created_at at time zone 'Asia/Yerevan')::date          as active_date,
           max(msg.created_at)                                          as last_at,
           (array_agg(msg.sender_role order by msg.created_at desc))[1] as last_role
    from linked l
    join messages msg on msg.chat_id = l.chat_id
    where l.chat_id is not null
      and msg.created_at >= now() - interval '120 days'
    group by l.agr_no, (msg.created_at at time zone 'Asia/Yerevan')::date
  ),
  feed_day as (
    select l.agr_no,
           (c.last_seen_at at time zone 'Asia/Yerevan')::date as active_date,
           c.last_seen_at                                     as last_at,
           null::text                                         as last_role
    from linked l
    join chats c on c.chat_id = l.chat_id
    where l.chat_id is not null
      and c.last_seen_at is not null
  ),
  combined as (
    select * from per_day
    union all
    select * from feed_day
  )
  insert into mqa_chat_activity (agr_no, active_date, last_at, last_sender_role)
  select agr_no,
         active_date,
         max(last_at),
         (array_agg(last_role order by last_at desc nulls last))[1]
  from combined
  group by agr_no, active_date
  on conflict (agr_no, active_date)
  do update set last_at          = excluded.last_at,
                last_sender_role = coalesce(excluded.last_sender_role,
                                            mqa_chat_activity.last_sender_role);
$function$;

-- Keep it current alongside the existing last-activity refresh. cron.schedule is
-- an upsert keyed by job name, so re-running this migration won't duplicate it.
select cron.schedule(
  'mqa_refresh_chat_activity',
  '*/15 * * * *',
  'select public.mqa_refresh_chat_activity();'
);

-- Populate immediately so the fix takes effect without waiting for the next tick.
select public.mqa_refresh_chat_activity();
