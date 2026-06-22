-- "Добавить чат в QA вручную" — let Margarita pull a chat INTO the scoring
-- page's "Активные за день" list for a given day even when the activity feed
-- didn't surface it (a chat from a previous day, or one missing from the feed
-- — items 1, 5, 6 of the June feedback). Per-(chat, day), the mirror image of
-- mqa_active_exclusions; removing it just deletes the row.
--
-- Idempotent: safe to re-run.
create table if not exists mqa_active_inclusions (
  agr_no       text not null,
  include_date date not null,
  created_at   timestamptz not null default now(),
  primary key (agr_no, include_date)
);

-- Server uses the service-role key (bypasses RLS); anon gets no access.
alter table mqa_active_inclusions enable row level security;
