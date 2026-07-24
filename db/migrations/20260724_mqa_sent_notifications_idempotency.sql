-- ---------------------------------------------------------------------------
-- Idempotency infrastructure for the client-notification sender (outbox).
--
-- The exactly-once problem (a non-idempotent Telegram API + a separate DB)
-- cannot be solved perfectly, but we get as close as possible by RESERVING a
-- send BEFORE calling Telegram:
--
--   1. reserve  — atomically claim the planned row (one attempt row per
--                 planned_id). If it is already reserved by a prior/parallel
--                 run, we DO NOT send again.
--   2. send     — one Telegram call.
--   3a. finalize (success) — mark the attempt delivered, write the clean
--       success journal row, and mark the plan 'sent' — in ONE transaction.
--   3b. fail (Telegram said no — definitively NOT delivered) — DELETE the
--       reservation so the next run may safely retry, and log the failure.
--
-- Guarantee: at-least-once for KNOWN failures (Telegram returned an error → not
-- delivered → safe to retry), and at-most-once for the only genuinely ambiguous
-- case (the process dies AFTER Telegram accepted but BEFORE finalize): the
-- reservation stays with no error, so the next run treats it as "already
-- attempted" and never re-sends. Correctness comes from the per-row reservation,
-- NOT from the single-run lease below (which is only an optimisation).
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

-- Clean success journal stays one-success-per-plan.
create unique index if not exists mqa_sent_notifications_one_success
  on public.mqa_sent_notifications (planned_id)
  where telegram_ok and planned_id is not null;

-- Reservation ledger: one attempt row per planned notification, with an
-- explicit outcome state machine:
--   null        — reserved / in-flight (or the process crashed mid-attempt)
--   'delivered' — sent + logged
--   'failed'    — Telegram DEFINITIVELY rejected (not delivered) → retryable
--   'held'      — ambiguous (network/timeout) → NOT retried (at-most-once)
create table if not exists public.mqa_notification_send_attempts (
  planned_id   bigint primary key,
  outcome      text,
  delivered    boolean not null default false,
  attempted_at timestamptz not null default now(),
  finalized_at timestamptz,
  error        text
);
alter table public.mqa_notification_send_attempts add column if not exists outcome text;
alter table public.mqa_notification_send_attempts enable row level security;

-- Reserve a send BEFORE calling Telegram. The reservation IS the arbiter — its
-- outcome column decides what a later run does, so no post-send DB failure can
-- silently cause a duplicate.
--   'reserved'          — proceed to send (first attempt, or a retry of a
--                          previously DEFINITIVE failure, reset here atomically).
--   'already_delivered' — a prior attempt delivered; plan reconciled; skip.
--   'already_attempted' — held (ambiguous) or in-flight/crashed → skip (no re-send).
create or replace function public.mqa_reserve_notification_send(p_planned_id bigint)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id      bigint;
  v_outcome text;
begin
  insert into public.mqa_notification_send_attempts (planned_id)
  values (p_planned_id)
  on conflict (planned_id) do nothing
  returning planned_id into v_id;

  if v_id is not null then
    return 'reserved';
  end if;

  -- Lock the existing row so a retry-reset can't race a concurrent run.
  select outcome into v_outcome
  from public.mqa_notification_send_attempts
  where planned_id = p_planned_id
  for update;

  if v_outcome = 'delivered' then
    update public.mqa_planned_notifications set status = 'sent', sent_at = now()
     where id = p_planned_id and status in ('planned', 'edited');
    return 'already_delivered';
  elsif v_outcome = 'failed' then
    -- DEFINITIVE prior failure (not delivered) → safe to retry: re-arm the row.
    update public.mqa_notification_send_attempts
       set outcome = null, error = null, attempted_at = now(), finalized_at = null
     where planned_id = p_planned_id;
    return 'reserved';
  end if;
  -- 'held' (ambiguous) or null (in-flight / crashed) → never re-send.
  return 'already_attempted';
end;
$$;

-- Finalize a SUCCESSFUL send atomically: attempt→delivered, clean journal row,
-- plan→sent — one transaction, so a delivery is never left unlogged.
create or replace function public.mqa_finalize_notification_sent(
  p_planned_id  bigint,
  p_agr_no      text,
  p_chat_id     text,
  p_category    text,
  p_subtype     text,
  p_language    text,
  p_full_text   text,
  p_template_id text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.mqa_notification_send_attempts
     set outcome = 'delivered', delivered = true, finalized_at = now(), error = null
   where planned_id = p_planned_id;

  insert into public.mqa_sent_notifications
    (agr_no, chat_id, category, subtype, language, full_text, template_id, planned_id, telegram_ok, telegram_error)
  values
    (p_agr_no, p_chat_id, p_category, p_subtype, p_language, p_full_text, p_template_id, p_planned_id, true, null)
  on conflict (planned_id) where telegram_ok and planned_id is not null do nothing;

  update public.mqa_planned_notifications set status = 'sent', sent_at = now()
   where id = p_planned_id and status in ('planned', 'edited');
end;
$$;

-- Record an AMBIGUOUS failure (a network error / timeout — Telegram may or may
-- not have delivered): KEEP the reservation so the next run never re-sends
-- (at-most-once), stamp the error, and log it for a human to review. This is the
-- only genuinely unavoidable case.
create or replace function public.mqa_hold_notification_send(
  p_planned_id  bigint,
  p_agr_no      text,
  p_chat_id     text,
  p_category    text,
  p_subtype     text,
  p_language    text,
  p_full_text   text,
  p_template_id text,
  p_error       text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.mqa_notification_send_attempts set outcome = 'held', error = p_error where planned_id = p_planned_id;
  insert into public.mqa_sent_notifications
    (agr_no, chat_id, category, subtype, language, full_text, template_id, planned_id, telegram_ok, telegram_error)
  values
    (p_agr_no, p_chat_id, p_category, p_subtype, p_language, p_full_text, p_template_id, p_planned_id, false,
     'AMBIGUOUS (not retried): ' || coalesce(p_error, ''));
end;
$$;

-- Record a DEFINITIVE failure (Telegram returned an error → NOT delivered): mark
-- the reservation 'failed' (kept, NOT deleted) so a later run's reserve re-arms
-- and safely retries it; log the failure. If this write itself fails the row
-- stays reserved/in-flight (null) → treated as at-most-once, never a duplicate.
create or replace function public.mqa_fail_notification_send(
  p_planned_id  bigint,
  p_agr_no      text,
  p_chat_id     text,
  p_category    text,
  p_subtype     text,
  p_language    text,
  p_full_text   text,
  p_template_id text,
  p_error       text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.mqa_notification_send_attempts set outcome = 'failed', error = p_error where planned_id = p_planned_id;
  insert into public.mqa_sent_notifications
    (agr_no, chat_id, category, subtype, language, full_text, template_id, planned_id, telegram_ok, telegram_error)
  values
    (p_agr_no, p_chat_id, p_category, p_subtype, p_language, p_full_text, p_template_id, p_planned_id, false, p_error);
end;
$$;

revoke all on function public.mqa_reserve_notification_send(bigint) from public;
revoke all on function public.mqa_finalize_notification_sent(bigint, text, text, text, text, text, text, text) from public;
revoke all on function public.mqa_fail_notification_send(bigint, text, text, text, text, text, text, text, text) from public;
revoke all on function public.mqa_hold_notification_send(bigint, text, text, text, text, text, text, text, text) from public;
grant execute on function public.mqa_reserve_notification_send(bigint) to service_role;
grant execute on function public.mqa_finalize_notification_sent(bigint, text, text, text, text, text, text, text) to service_role;
grant execute on function public.mqa_fail_notification_send(bigint, text, text, text, text, text, text, text, text) to service_role;
grant execute on function public.mqa_hold_notification_send(bigint, text, text, text, text, text, text, text, text) to service_role;

-- Single-run lease (OPTIMISATION only — correctness is the per-row reservation
-- above). Owned by a token so only the holder can release it.
create table if not exists public.mqa_send_run_lock (
  id         integer primary key default 1 check (id = 1),
  locked_at  timestamptz,
  lock_token text
);
insert into public.mqa_send_run_lock (id, locked_at, lock_token) values (1, null, null) on conflict (id) do nothing;

create or replace function public.mqa_try_acquire_send_lock(p_token text, p_ttl_seconds integer default 900)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_got boolean;
begin
  update public.mqa_send_run_lock set locked_at = now(), lock_token = p_token
   where id = 1 and (locked_at is null or now() - locked_at > make_interval(secs => p_ttl_seconds))
  returning true into v_got;
  return coalesce(v_got, false);
end;
$$;

create or replace function public.mqa_release_send_lock(p_token text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.mqa_send_run_lock set locked_at = null, lock_token = null where id = 1 and lock_token = p_token;
end;
$$;

revoke all on function public.mqa_try_acquire_send_lock(text, integer) from public;
revoke all on function public.mqa_release_send_lock(text) from public;
grant execute on function public.mqa_try_acquire_send_lock(text, integer) to service_role;
grant execute on function public.mqa_release_send_lock(text) to service_role;

-- Test-mode preview log (unchanged): dedups test-chat previews without touching
-- the production plan/journal.
create table if not exists public.mqa_test_send_log (
  planned_id bigint primary key,
  chat_id    text,
  sent_at    timestamptz not null default now()
);
alter table public.mqa_test_send_log enable row level security;