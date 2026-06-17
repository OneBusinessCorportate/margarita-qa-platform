-- ---------------------------------------------------------------------------
-- Margarita QA Platform — Supabase / Postgres schema.
-- Run in the Supabase SQL editor (or via psql with DATABASE_URL).
-- Tables mirror src/lib/types.ts.
--
-- IMPORTANT: tables are PREFIXED with `mqa_` because the deployment targets a
-- SHARED Supabase project (OB FAQ) that already contains unrelated tables
-- (including a `chats` table with real data). The prefix keeps this app
-- isolated. Override via DB_TABLE_PREFIX (see src/lib/tables.ts).
--
-- RLS is enabled with NO policies: the server uses the service-role key (which
-- bypasses RLS), while the anon key gets no access — a secure default for an
-- internal back-office tool where all reads/writes go through API routes.
-- ---------------------------------------------------------------------------

create table if not exists mqa_accountants (
  name        text primary key,
  active      boolean not null default true,
  role        text not null default 'accountant'
              check (role in ('accountant', 'other-specialist', 'dismissed'))
);

create table if not exists mqa_chats (
  agr_no              text primary key,        -- e.g. '59' or 'B-3302'
  hvhh                text,
  name_agr            text,
  name_tax            text,
  status              text not null default 'Active'
                      check (status in ('Active', 'Inactive')),
  tax_activation_date date,
  chat_name           text not null,
  chat_link           text,
  accountant          text references mqa_accountants(name),
  manager             text,
  debts               text,
  created_date        date,
  last_activity_date  date          -- last real chat activity (bot feed / import)
);

-- If the table already exists from an earlier deploy, add the column in place.
alter table mqa_chats add column if not exists last_activity_date date;

-- Config-driven scoring criteria (model A). Seeded from src/lib/scoring.ts.
create table if not exists mqa_criteria (
  id           text primary key,
  name         text not null,
  weight       integer not null,
  scale_max    integer not null default 5,
  descriptions jsonb not null default '{}'::jsonb
);

create table if not exists mqa_evaluations (
  id            text primary key default gen_random_uuid()::text,
  chat_agr_no   text not null references mqa_chats(agr_no),
  period        text not null,                 -- e.g. '202603'
  checking_date date not null,
  -- Which role this row grades: accountant | manager | lawyer. A chat can be
  -- scored once per role per checking_date. Legacy rows default to 'accountant'.
  role          text not null default 'accountant'
                check (role in ('accountant', 'manager', 'lawyer')),
  accountant    text,                          -- graded person's name (any role)
  scores        jsonb not null default '{}'::jsonb, -- { criteria?, tasks? }
  total_score   double precision not null default 0, -- numeric would surface as string via PostgREST
  quality_band  text not null,
  comment       text,
  created_at    timestamptz not null default now()
);

-- If the table predates the per-role split, add the column in place.
alter table mqa_evaluations add column if not exists role text not null default 'accountant';

create index if not exists mqa_evaluations_checking_date_idx on mqa_evaluations (checking_date);
create index if not exists mqa_evaluations_accountant_idx on mqa_evaluations (accountant);
create index if not exists mqa_evaluations_chat_idx on mqa_evaluations (chat_agr_no);

create table if not exists mqa_tasks (
  id                  text primary key default gen_random_uuid()::text,
  chat_agr_no         text not null references mqa_chats(agr_no),
  type                text not null default 'single'
                      check (type in ('monthly', 'single')),
  category            text,                 -- null for single tasks
  status              text,
  prev_status         text,
  due_date_original   date,
  due_date_postponed  date,
  completed_at        date,
  priority            text,                 -- Low / Medium / High
  description         text,
  result              text,
  task_status         text,                 -- Completed (On Time) / Completed (Late) / Overdue / Cancelled / -
  accountant          text,
  checking_date       date,
  period              text
);

create index if not exists mqa_tasks_chat_idx on mqa_tasks (chat_agr_no);

-- Registration-department weekly QA — graded per MANAGER, per WEEK on the
-- `registration` scheme (start 100, minus penalty points). Separate from the
-- chat-bound mqa_evaluations table.
create table if not exists mqa_manager_evaluations (
  id            text primary key default gen_random_uuid()::text,
  manager       text not null,
  week_start    date not null,                 -- Monday of the graded week
  period        text not null,                 -- ISO week label, e.g. '2026-W25'
  scores        jsonb not null default '{}'::jsonb, -- { registration: { critical, speed, feedback } }
  total_score   double precision not null default 100,
  quality_band  text not null,
  comment       text,
  created_at    timestamptz not null default now()
);

create index if not exists mqa_manager_evals_week_idx
  on mqa_manager_evaluations (week_start);
create index if not exists mqa_manager_evals_manager_idx
  on mqa_manager_evaluations (manager);
-- One evaluation per manager per week.
create unique index if not exists mqa_manager_evals_unique
  on mqa_manager_evaluations (manager, week_start);

-- App user accounts (credentials auth). Passwords are scrypt-hashed
-- (see src/lib/users.ts): format 'scrypt$<saltHex>$<hashHex>'.
create table if not exists mqa_users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

-- Нарушения (violations) log — item 6.
create table if not exists mqa_violations (
  id             text primary key default gen_random_uuid()::text,
  vdate          date not null,
  accountant     text,
  chat_agr_no    text,
  client         text,
  severity       text,   -- Среднее / Критичное / Грубое
  violation_type text,   -- сервисное нарушение (описание)
  gross          text,
  sanction       numeric,
  note           text,
  created_at     timestamptz not null default now()
);

-- Chats manually hidden from the scoring "Активные за день" list, per (chat,
-- day). See db/migrations/20260617_mqa_active_exclusions.sql.
create table if not exists mqa_active_exclusions (
  agr_no       text not null,
  exclude_date date not null,
  created_at   timestamptz not null default now(),
  primary key (agr_no, exclude_date)
);

-- Saved Отчёт snapshots (report history). The full computed report is stored as
-- JSON so a past period can be re-opened as-was. See
-- db/migrations/20260617_mqa_report_snapshots.sql.
create table if not exists mqa_report_snapshots (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  filters    jsonb not null default '{}'::jsonb,
  report     jsonb not null,
  created_by text,
  created_at timestamptz not null default now()
);

-- Lock down to service-role access only.
alter table mqa_accountants         enable row level security;
alter table mqa_violations          enable row level security;
alter table mqa_active_exclusions   enable row level security;
alter table mqa_report_snapshots    enable row level security;
alter table mqa_chats               enable row level security;
alter table mqa_criteria            enable row level security;
alter table mqa_evaluations         enable row level security;
alter table mqa_manager_evaluations enable row level security;
alter table mqa_tasks               enable row level security;
alter table mqa_users               enable row level security;

-- ---------------------------------------------------------------------------
-- Live activity sync (keeps mqa_chats.last_activity_date current)
-- ---------------------------------------------------------------------------
-- The importer does not set last_activity_date, so this scheduled job keeps it
-- in sync with the live Telegram feed (public.chats) by matching the Telegram
-- chat id embedded in chat_link. This is what makes the dashboard's
-- "Активных чатов" (active chats today) reflect same-day activity.
-- Runs every 15 minutes via pg_cron. Canonical definition:
--   db/migrations/20260617_mqa_refresh_last_activity_every_15min.sql
create extension if not exists pg_cron;

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

select cron.schedule(
  'mqa_refresh_last_activity',
  '*/15 * * * *',
  'select public.mqa_refresh_last_activity();'
);
