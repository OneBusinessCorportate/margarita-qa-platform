-- Treat reactions on client messages as answered.
--
-- Previously, a chat was marked as unanswered if the last message was from the
-- client. This didn't account for reactions: if the accountant added a reaction
-- emoji to the client's message, that should count as an answer/acknowledgment.
--
-- Updated logic: Check for any staff activity (message or reaction) after the
-- last client message. If found, the chat is no longer marked as unanswered.
--
-- Idempotent: safe to re-run.

create or replace function public.mqa_refresh_last_activity()
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
  last_msg as (
    select distinct on (msg.chat_id)
           msg.chat_id, msg.created_at, msg.sender_role
    from messages msg
    join (select distinct chat_id from linked where chat_id is not null) l
      on l.chat_id = msg.chat_id
    order by msg.chat_id, msg.created_at desc
  ),
  -- Check if there's any activity (message or reaction) from staff after the last client message.
  -- This covers both text replies and reaction emoji acknowledgments.
  has_staff_response as (
    select distinct l.chat_id
    from linked l
    join messages msg_client on msg_client.chat_id = l.chat_id
    join messages msg_response on msg_response.chat_id = l.chat_id
    where l.chat_id is not null
      and msg_client.sender_role = 'client'
      and msg_response.sender_role != 'client'
      and msg_response.created_at > msg_client.created_at
  ),
  src as (
    select l.agr_no,
           coalesce(lm.created_at, c.last_seen_at) as last_at,
           lm.sender_role                          as last_role,
           sr.chat_id is not null                  as has_staff_response
    from linked l
    left join chats c     on c.chat_id  = l.chat_id
    left join last_msg lm on lm.chat_id = l.chat_id
    left join has_staff_response sr on sr.chat_id = l.chat_id
    where l.chat_id is not null
      and coalesce(lm.created_at, c.last_seen_at) is not null
  )
  update mqa_chats m
  set last_activity_at   = src.last_at,
      last_activity_date = (src.last_at at time zone 'Asia/Yerevan')::date,
      last_sender_role   = src.last_role,
      -- Unanswered = the client had the last message AND there's no staff response.
      -- Staff response includes both messages and reactions.
      unanswered         = case when src.last_role is null then null
                                when src.has_staff_response then false
                                else src.last_role = 'client' end
  from src
  where m.agr_no = src.agr_no
    and (
      m.last_activity_at   is distinct from src.last_at
      or m.last_activity_date is distinct from (src.last_at at time zone 'Asia/Yerevan')::date
      or m.last_sender_role  is distinct from src.last_role
      or m.unanswered        is distinct from (case when src.last_role is null then null
                                                    when src.has_staff_response then false
                                                    else src.last_role = 'client' end)
    );
$function$;

-- Refresh now so the change takes effect immediately.
select public.mqa_refresh_last_activity();
