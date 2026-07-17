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
  -- Ручное закрепление бухгалтера (п.1): sync-sheet не перезаписывает accountant,
  -- когда true. См. db/migrations/20260713_mqa_accountant_pin.sql.
  accountant_pinned   boolean not null default false,
  manager             text,
  debts               text,
  created_date        date,
  last_activity_date  date,         -- last real chat activity, date (bot feed / import)
  last_activity_at    timestamptz,  -- last real chat activity, precise time (for intra-day order)
  last_sender_role    text,         -- role of the last message's sender
  unanswered          boolean       -- true when the client had the last word (still unanswered)
);

-- If the table already exists from an earlier deploy, add the columns in place.
alter table mqa_chats add column if not exists last_activity_date date;
alter table mqa_chats add column if not exists last_activity_at   timestamptz;
alter table mqa_chats add column if not exists last_sender_role   text;
alter table mqa_chats add column if not exists unanswered         boolean;

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
  scores        jsonb not null default '{}'::jsonb, -- { criteria?, tasks?, ai? }
  total_score   double precision not null default 0, -- numeric would surface as string via PostgREST
  quality_band  text not null,
  comment       text,
  created_at    timestamptz not null default now(),
  -- Фича «Уверенность модели»: уверенность AI в ИСХОДНОЙ оценке (0..100, %),
  -- продублированная исходная общая оценка AI и статус проверки Маргаритой.
  -- NULL у ai_confidence ⇒ «Нет данных» (не 0%). Исходный AI-снимок также лежит
  -- в scores->'ai' и не перезаписывается при правке. См.
  -- db/migrations/20260716_mqa_evaluation_confidence.sql.
  ai_confidence double precision
                check (ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 100)),
  ai_total      double precision,
  review_status text not null default 'not_reviewed'
                check (review_status in ('not_reviewed', 'accepted', 'corrected')),
  reviewed_by   text,
  reviewed_at   timestamptz,
  -- One evaluation per chat per role per day. The app + importer upsert against
  -- this; without it, re-imports created duplicate rows that double-counted in
  -- the report. Also prevents duplicate review-history records for a (chat, day,
  -- role). See db/migrations/20260617_mqa_dedupe_evaluations_and_fix_manager.sql.
  constraint mqa_evaluations_chat_date_role_key
    unique (chat_agr_no, checking_date, role)
);

-- If the table predates the per-role split, add the column in place.
alter table mqa_evaluations add column if not exists role text not null default 'accountant';
-- Model-confidence columns (idempotent, for tables from an earlier deploy).
alter table mqa_evaluations add column if not exists ai_confidence double precision;
alter table mqa_evaluations add column if not exists ai_total      double precision;
alter table mqa_evaluations add column if not exists review_status text not null default 'not_reviewed';
alter table mqa_evaluations add column if not exists reviewed_by   text;
alter table mqa_evaluations add column if not exists reviewed_at   timestamptz;

create index if not exists mqa_evaluations_checking_date_idx on mqa_evaluations (checking_date);
create index if not exists mqa_evaluations_accountant_idx on mqa_evaluations (accountant);
create index if not exists mqa_evaluations_chat_idx on mqa_evaluations (chat_agr_no);
create index if not exists mqa_evaluations_review_status_idx on mqa_evaluations (review_status);
create index if not exists mqa_evaluations_ai_confidence_idx on mqa_evaluations (ai_confidence);

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
  period              text,
  -- A recurring / non-closable task stays OPEN until the accountant does it AND
  -- QA confirms it (boss's rule). See db/migrations/20260619_mqa_tasks_recurring_qa_confirm.sql.
  recurring           boolean not null default false,
  qa_confirmed        boolean not null default false,
  qa_confirmed_at     timestamptz,
  qa_confirmed_by     text
);

alter table mqa_tasks add column if not exists recurring      boolean not null default false;
alter table mqa_tasks add column if not exists qa_confirmed    boolean not null default false;
alter table mqa_tasks add column if not exists qa_confirmed_at timestamptz;
alter table mqa_tasks add column if not exists qa_confirmed_by text;

create index if not exists mqa_tasks_chat_idx on mqa_tasks (chat_agr_no);

-- Отдельный трекер «Системные задачи бухгалтеров» (п.6). НЕ смешивается с
-- апелляциями и с общими задачами по чатам. Опциональная мягкая связь с
-- QA-тикетом (mqa_violations). Полное определение — в
-- db/migrations/20260717_mqa_accountant_system_tasks.sql.
create table if not exists mqa_accountant_system_tasks (
  id                 text primary key default gen_random_uuid()::text,
  ticket_id          text references mqa_violations(id) on delete set null,
  accountant_name    text,
  client_name        text,
  chat_id            text,
  title              text not null,
  description        text,
  priority           text not null default 'Medium'
                     check (priority in ('Low','Medium','High')),
  status             text not null default 'new'
                     check (status in ('new','in_progress','postponed','completed','cancelled')),
  due_date_original  date,
  due_date_postponed date,
  completed_at       timestamptz,
  created_by         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists mqa_ast_ticket_idx     on mqa_accountant_system_tasks (ticket_id);
create index if not exists mqa_ast_accountant_idx on mqa_accountant_system_tasks (accountant_name);
create index if not exists mqa_ast_status_idx      on mqa_accountant_system_tasks (status);

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
  -- Подтверждено Маргаритой (по умолчанию true). См.
  -- db/migrations/20260713_mqa_violations_confirmed_appeal_status.sql.
  confirmed       boolean not null default true,
  appeal_status   text,   -- легаси: null | 'appealed' | 'approved' | 'rejected'
  -- Рабочий цикл «бухгалтер → апелляция → решение» (Phase 11). См.
  -- db/migrations/20260716_mqa_violation_workflow_appeals.sql.
  status          text not null default 'new'
                  check (status in ('new','acknowledged','appealed','appeal_approved','appeal_rejected')),
  acknowledged_at timestamptz,   -- когда бухгалтер нажал «Ознакомлен»
  acknowledged_by text,          -- кто ознакомился
  created_at     timestamptz not null default now()
);
alter table mqa_violations add column if not exists confirmed       boolean not null default true;
alter table mqa_violations add column if not exists appeal_status    text;
alter table mqa_violations add column if not exists status           text not null default 'new';
alter table mqa_violations add column if not exists acknowledged_at  timestamptz;
alter table mqa_violations add column if not exists acknowledged_by  text;
create index if not exists mqa_violations_status_idx     on mqa_violations (status);
create index if not exists mqa_violations_accountant_idx on mqa_violations (accountant);
create index if not exists mqa_violations_vdate_idx      on mqa_violations (vdate);

-- Апелляции бухгалтеров на конкретные нарушения (mqa_violation_appeals).
-- Связаны с нарушением по violation_id (FK). Одно нарушение — максимум одна
-- активная (pending) апелляция (частичный уникальный индекс). См.
-- db/migrations/20260716_mqa_violation_workflow_appeals.sql.
create table if not exists mqa_violation_appeals (
  id               text primary key default gen_random_uuid()::text,
  violation_id     text not null references mqa_violations(id) on delete cascade,
  accountant       text,
  appeal_text      text not null,
  status           text not null default 'pending'
                   check (status in ('pending','approved','rejected')),
  decision_comment text,
  resolved_by      text,
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz
);
create index if not exists mqa_violation_appeals_violation_idx   on mqa_violation_appeals (violation_id);
create index if not exists mqa_violation_appeals_status_idx      on mqa_violation_appeals (status);
create index if not exists mqa_violation_appeals_accountant_idx  on mqa_violation_appeals (accountant);
create index if not exists mqa_violation_appeals_created_idx     on mqa_violation_appeals (created_at desc);
create unique index if not exists mqa_violation_appeals_one_pending
  on mqa_violation_appeals (violation_id) where status = 'pending';

-- Chats manually hidden from the scoring "Активные за день" list, per (chat,
-- day). See db/migrations/20260617_mqa_active_exclusions.sql.
create table if not exists mqa_active_exclusions (
  agr_no       text not null,
  exclude_date date not null,
  created_at   timestamptz not null default now(),
  primary key (agr_no, exclude_date)
);

-- Chats manually pulled INTO the scoring "Активные за день" list, per (chat,
-- day) — the mirror of mqa_active_exclusions. See
-- db/migrations/20260622_mqa_active_inclusions.sql.
create table if not exists mqa_active_inclusions (
  agr_no       text not null,
  include_date date not null,
  created_at   timestamptz not null default now(),
  primary key (agr_no, include_date)
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

-- Manual per-day chat-score overrides + audit history (п.8). Append-only:
-- latest row per (chat_agr_no, score_date) is the effective override.
create table if not exists mqa_chat_score_overrides (
  id           text primary key default gen_random_uuid()::text,
  chat_agr_no  text not null references mqa_chats(agr_no) on delete cascade,
  client_name  text,
  score_date   date not null,
  old_score    double precision,
  new_score    double precision not null,
  changed_by   text,
  comment      text not null,
  created_at   timestamptz not null default now()
);
create index if not exists mqa_chat_score_overrides_lookup_idx
  on mqa_chat_score_overrides (chat_agr_no, score_date, created_at desc);

-- Lock down to service-role access only.
alter table mqa_accountants         enable row level security;
alter table mqa_violations          enable row level security;
alter table mqa_violation_appeals   enable row level security;
alter table mqa_active_exclusions   enable row level security;
alter table mqa_active_inclusions   enable row level security;
alter table mqa_report_snapshots    enable row level security;
alter table mqa_chat_score_overrides enable row level security;
alter table mqa_chats               enable row level security;
alter table mqa_criteria            enable row level security;
alter table mqa_evaluations         enable row level security;
alter table mqa_manager_evaluations enable row level security;
alter table mqa_tasks               enable row level security;
alter table mqa_users               enable row level security;

-- ---------------------------------------------------------------------------
-- Live activity sync (keeps mqa_chats activity columns current)
-- ---------------------------------------------------------------------------
-- The importer does not set activity, so this scheduled job keeps it in sync
-- with the live Telegram feed (public.chats / public.messages) by matching the
-- Telegram chat id embedded in chat_link. It populates:
--   • last_activity_date / last_activity_at — same-day "Активных чатов" + order
--   • last_sender_role / unanswered          — surface chats still awaiting a reply
-- Runs every 15 minutes via pg_cron. Canonical definition:
--   db/migrations/20260617_mqa_sync_activity_timestamp_and_unanswered.sql
create extension if not exists pg_cron;

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
  src as (
    select l.agr_no,
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

select cron.schedule(
  'mqa_refresh_last_activity',
  '*/15 * * * *',
  'select public.mqa_refresh_last_activity();'
);
