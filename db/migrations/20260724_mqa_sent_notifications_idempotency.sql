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

-- Atomic "record a delivery result" -----------------------------------------
-- Inserts the mandatory journal row AND (on success) marks the plan 'sent' in
-- ONE transaction, so a delivered message is never left unlogged and 'sent' is
-- never set without a journal row. The partial-unique index makes a success
-- idempotent: a second success for the same planned_id is reported as
-- 'duplicate' and does NOT re-mark anything.
create or replace function public.mqa_record_notification_sent(
  p_planned_id  bigint,
  p_agr_no      text,
  p_chat_id     text,
  p_category    text,
  p_subtype     text,
  p_language    text,
  p_full_text   text,
  p_template_id text,
  p_ok          boolean,
  p_error       text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
begin
  if p_ok then
    insert into public.mqa_sent_notifications
      (agr_no, chat_id, category, subtype, language, full_text, template_id, planned_id, telegram_ok, telegram_error)
    values
      (p_agr_no, p_chat_id, p_category, p_subtype, p_language, p_full_text, p_template_id, p_planned_id, true, null)
    on conflict (planned_id) where telegram_ok and planned_id is not null do nothing
    returning id into v_id;

    if v_id is null then
      return 'duplicate';  -- a success was already recorded (concurrent/prior run)
    end if;

    update public.mqa_planned_notifications
       set status = 'sent', sent_at = now()
     where id = p_planned_id and status in ('planned', 'edited');
    return 'recorded';
  else
    insert into public.mqa_sent_notifications
      (agr_no, chat_id, category, subtype, language, full_text, template_id, planned_id, telegram_ok, telegram_error)
    values
      (p_agr_no, p_chat_id, p_category, p_subtype, p_language, p_full_text, p_template_id, p_planned_id, false, p_error);
    return 'failed_logged';
  end if;
end;
$$;

revoke all on function public.mqa_record_notification_sent(bigint, text, text, text, text, text, text, text, boolean, text) from public;

-- Single-run lease lock ------------------------------------------------------
-- Belt-and-suspenders against overlapping sender runs (the Render cron is a
-- single instance, but this makes concurrent delivery impossible even if it is
-- ever invoked twice): a run acquires the lease only if it is free or the prior
-- lease has expired (crash-safe). Prevents two runs from both delivering.
create table if not exists public.mqa_send_run_lock (
  id        integer primary key default 1 check (id = 1),
  locked_at timestamptz
);
insert into public.mqa_send_run_lock (id, locked_at) values (1, null) on conflict (id) do nothing;

create or replace function public.mqa_try_acquire_send_lock(p_ttl_seconds integer default 900)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_got boolean;
begin
  update public.mqa_send_run_lock
     set locked_at = now()
   where id = 1
     and (locked_at is null or now() - locked_at > make_interval(secs => p_ttl_seconds))
  returning true into v_got;
  return coalesce(v_got, false);
end;
$$;

create or replace function public.mqa_release_send_lock()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.mqa_send_run_lock set locked_at = null where id = 1;
end;
$$;

revoke all on function public.mqa_try_acquire_send_lock(integer) from public;
revoke all on function public.mqa_release_send_lock() from public;
