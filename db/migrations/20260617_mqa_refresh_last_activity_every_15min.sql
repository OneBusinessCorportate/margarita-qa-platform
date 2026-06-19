-- Keep mqa_chats.last_activity_date continuously in sync with the live Telegram
-- feed (public.chats) so the dashboard's "Активных чатов" (active chats today)
-- always reflects same-day activity.
--
-- Background / root cause this fixes
-- ----------------------------------
-- The importer (scripts/import-xlsx.ts) never writes last_activity_date, and
-- mqa_tasks is empty, so the only thing that can keep this column current is the
-- refresh job below. A refresh function + cron job already existed, BUT the cron
-- ran only ONCE a day at 00:15 UTC (04:15 Asia/Yerevan, before business hours).
-- That meant same-day chat activity never made it into mqa_chats during the
-- working day, so "active chats for today" sat near zero / stale until the next
-- pre-dawn run. Fix: keep the (correct) matching function and reschedule it to
-- run every 15 minutes.
--
-- Idempotent: safe to re-run.

create extension if not exists pg_cron;

-- Refresh function: link mqa_chats -> chats via the Telegram chat id embedded in
-- chat_link (e.g. https://web.telegram.org/a/#-4838549046 -> -4838549046), then
-- set last_activity_date to the most recent message day (Asia/Yerevan) for that
-- chat. Only rows whose value actually changed are written.
create or replace function public.mqa_refresh_last_activity()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update mqa_chats m
  set last_activity_date = src.last_activity
  from (
    select m2.agr_no,
           max((c.last_seen_at at time zone 'Asia/Yerevan')::date) as last_activity
    from mqa_chats m2
    join chats c
      on c.chat_id = (case
                        when regexp_replace(m2.chat_link, '^.*#', '') ~ '^-?\d+$'
                        then regexp_replace(m2.chat_link, '^.*#', '')::bigint
                      end)
    where c.last_seen_at is not null
    group by m2.agr_no
  ) src
  where m.agr_no = src.agr_no
    and m.last_activity_date is distinct from src.last_activity;
$function$;

-- Reschedule from once-daily to every 15 minutes. cron.schedule(name, ...) is an
-- upsert keyed by job name, so this safely replaces the old '15 0 * * *' schedule
-- on the existing 'mqa_refresh_last_activity' job (no duplicate job is created).
select cron.schedule(
  'mqa_refresh_last_activity',
  '*/15 * * * *',
  'select public.mqa_refresh_last_activity();'
);

-- Run once now so the change takes effect immediately, without waiting for the
-- next 15-minute tick.
select public.mqa_refresh_last_activity();
