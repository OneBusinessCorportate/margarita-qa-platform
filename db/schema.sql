-- ---------------------------------------------------------------------------
-- Margarita QA Platform — Supabase / Postgres schema.
-- Run in the Supabase SQL editor (or via psql with DATABASE_URL).
-- Tables mirror src/lib/types.ts.
-- ---------------------------------------------------------------------------

create table if not exists accountants (
  name        text primary key,
  active      boolean not null default true,
  role        text not null default 'accountant'
              check (role in ('accountant', 'other-specialist', 'dismissed'))
);

create table if not exists chats (
  agr_no              text primary key,        -- e.g. '59' or 'B-3302'
  hvhh                text,
  name_agr            text,
  name_tax            text,
  status              text not null default 'Active'
                      check (status in ('Active', 'Inactive')),
  tax_activation_date date,
  chat_name           text not null,
  chat_link           text,
  accountant          text references accountants(name),
  manager             text,
  debts               text,
  created_date        date
);

-- Config-driven scoring criteria (model A). Seeded from src/lib/scoring.ts.
create table if not exists criteria (
  id           text primary key,
  name         text not null,
  weight       integer not null,
  scale_max    integer not null default 5,
  descriptions jsonb not null default '{}'::jsonb
);

create table if not exists evaluations (
  id            uuid primary key default gen_random_uuid(),
  chat_agr_no   text not null references chats(agr_no),
  period        text not null,                 -- e.g. '202603'
  checking_date date not null,
  accountant    text,
  scores        jsonb not null default '{}'::jsonb, -- { criteria?, tasks? }
  total_score   numeric not null default 0,
  quality_band  text not null,
  comment       text,
  created_at    timestamptz not null default now()
);

create index if not exists evaluations_checking_date_idx on evaluations (checking_date);
create index if not exists evaluations_accountant_idx on evaluations (accountant);
create index if not exists evaluations_chat_idx on evaluations (chat_agr_no);

create table if not exists tasks (
  id                  uuid primary key default gen_random_uuid(),
  chat_agr_no         text not null references chats(agr_no),
  type                text not null default 'monthly'
                      check (type in ('monthly', 'single')),
  category            text not null,
  status              text,
  prev_status         text,
  due_date_original   date,
  due_date_postponed  date,
  completed_at        date,
  priority            integer,
  description         text,
  result              text,
  task_status         text
                      check (task_status is null or task_status in
                        ('Completed On Time', 'Late', 'Overdue', 'Cancelled'))
);

create index if not exists tasks_chat_idx on tasks (chat_agr_no);
