-- Extend the live-feed sync so the QA scoring page can (a) order chats by the
-- real time of the last message within a day (not just the date), and (b) flag
-- chats whose last message is from the CLIENT — i.e. still unanswered — so QA
-- can pick up yesterday's unanswered chats too.
--
-- Background: mqa_chats was synced only with last_activity_date (a DATE), which
-- is why the scoring list looked "randomly" ordered inside a day and had no way
-- to surface unanswered chats. We add precise timestamp + last-sender tracking
-- and fold it into the existing 15-minute refresh job (see
-- 20260617_mqa_refresh_last_activity_every_15min.sql — the cron job calls this
-- same function, so replacing the function is enough).
--
-- Idempotent: safe to re-run.

alter table mqa_chats add column if not exists last_activity_at timestamptz;
alter table mqa_chats add column if not exists last_sender_role text;
alter table mqa_chats add column if not exists unanswered       boolean;

create or replace function public.mqa_refresh_last_activity()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  with linked as (
    -- mqa_chats -> live chat id embedded in chat_link (…#-4838549046).
    select m.agr_no,
           case when regexp_replace(m.chat_link, '^.*#', '') ~ '^-?\d+$'
                then regexp_replace(m.chat_link, '^.*#', '')::bigint
           end as chat_id
    from mqa_chats m
  ),
  last_msg as (
    -- The most recent message per linked chat: precise time + who spoke last.
    select distinct on (msg.chat_id)
           msg.chat_id, msg.created_at, msg.sender_role
    from messages msg
    join (select distinct chat_id from linked where chat_id is not null) l
      on l.chat_id = msg.chat_id
    order by msg.chat_id, msg.created_at desc
  ),
  src as (
    select l.agr_no,
           -- Prefer message-level activity; fall back to the feed's last_seen_at
           -- for chats the message store hasn't captured yet.
           coalesce(lm.created_at, c.last_seen_at) as last_at,
           lm.sender_role                          as last_role
    from linked l
    left join chats c     on c.chat_id  = l.chat_id
    left join last_msg lm on lm.chat_id = l.chat_id
    where l.chat_id is not null
      and coalesce(lm.created_at, c.last_seen_at) is not null
  )
  update mqa_chats m
  set last_activity_at   = src.last_at,
      last_activity_date = (src.last_at at time zone 'Asia/Yerevan')::date,
      last_sender_role   = src.last_role,
      -- Unanswered = the client had the last word. Null when we don't know the
      -- last sender (feed-only chats with no captured messages).
      unanswered         = case when src.last_role is null then null
                                else src.last_role = 'client' end
  from src
  where m.agr_no = src.agr_no
    and (
      m.last_activity_at   is distinct from src.last_at
      or m.last_activity_date is distinct from (src.last_at at time zone 'Asia/Yerevan')::date
      or m.last_sender_role  is distinct from src.last_role
      or m.unanswered        is distinct from (case when src.last_role is null then null
                                                    else src.last_role = 'client' end)
    );
$function$;

-- Run once now so the new columns populate immediately (the existing
-- '*/15 * * * *' cron job keeps calling this same function thereafter).
select public.mqa_refresh_last_activity();
