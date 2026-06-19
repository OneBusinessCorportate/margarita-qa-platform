-- "Скрыть из активных за день" — let QA manually drop an unimportant chat from
-- the scoring page's "Активные за день" list for a given day. Per-(chat, day),
-- so hiding a chat today does NOT affect any other day; it reappears tomorrow if
-- active again. Restoring just deletes the row.
--
-- Idempotent: safe to re-run.
create table if not exists mqa_active_exclusions (
  agr_no       text not null,
  exclude_date date not null,
  created_at   timestamptz not null default now(),
  primary key (agr_no, exclude_date)
);

-- Server uses the service-role key (bypasses RLS); anon gets no access.
alter table mqa_active_exclusions enable row level security;
