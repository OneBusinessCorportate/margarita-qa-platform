-- ---------------------------------------------------------------------------
-- mqa_published_reports — the accountant-facing daily report AFTER Margarita
-- has reviewed / edited / approved it.
--
-- WHY. The отчёт used to be a server-generated PDF that was auto-computed and
-- could be WRONG (e.g. «Общий уровень сервиса: 0%», an accountant with a
-- critical chat shown at 100). Owner decision: drop the PDF; instead Margarita
-- sees the generated report on the platform, EDITS it to fix any wording/number,
-- APPROVES it, and only the approved text is shown to accountants (mirrored into
-- kk-accountants-feedback-form through the read-only view kk_published_reports).
--
-- Append-only: every publish inserts a new row; the LATEST row (by published_at)
-- is the current report the accountants see. History is kept for audit.
--
-- Idempotent: safe to re-run.
-- ---------------------------------------------------------------------------

create table if not exists mqa_published_reports (
  id           text primary key default gen_random_uuid()::text,
  title        text not null,               -- e.g. «Ежедневный отчёт бухгалтерии»
  body         text not null,               -- the Margarita-edited report text
  report_date  date,                        -- the day / period the report covers
  period_label text,                         -- human label of the covered period
  published_by text,                         -- who approved / published (email)
  published_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index if not exists mqa_published_reports_published_idx
  on mqa_published_reports (published_at desc);

-- Server uses the service-role key (bypasses RLS); anon gets no direct access
-- (the accountant app reads through the definer-rights kk_published_reports view).
alter table mqa_published_reports enable row level security;
