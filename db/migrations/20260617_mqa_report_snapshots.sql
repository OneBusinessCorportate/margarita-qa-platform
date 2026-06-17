-- Report history: a saved snapshot of the Отчёт (dashboard) for a given filter
-- set, so QA can re-open a previous month/period exactly as it was, from the
-- site's interface. The full computed report is stored as JSON.
--
-- Idempotent: safe to re-run.
create table if not exists mqa_report_snapshots (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  filters    jsonb not null default '{}'::jsonb,
  report     jsonb not null,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists mqa_report_snapshots_created_idx
  on mqa_report_snapshots (created_at desc);

-- Server uses the service-role key (bypasses RLS); anon gets no access.
alter table mqa_report_snapshots enable row level security;
