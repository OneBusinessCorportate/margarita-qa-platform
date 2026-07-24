-- ---------------------------------------------------------------------------
-- Idempotency ledger for the client-notification sender.
--
-- The sender (scripts/send-notifications.ts) uses mqa_sent_notifications as the
-- record of what was actually delivered. This partial unique index guarantees
-- AT MOST ONE successful send per planned notification: a second attempt to log
-- a success for the same planned_id fails, so a race / double-run cannot record
-- (and the sender treats an existing success as "already delivered" and does not
-- re-send). Failed attempts (telegram_ok = false) are NOT constrained, so
-- retries after a failure are allowed.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'mqa_sent_notifications'
  ) then
    raise exception 'Prerequisite missing: apply 20260723_mqa_notifications_v1.sql first.';
  end if;
end $$;

create unique index if not exists mqa_sent_notifications_one_success
  on public.mqa_sent_notifications (planned_id)
  where telegram_ok and planned_id is not null;
