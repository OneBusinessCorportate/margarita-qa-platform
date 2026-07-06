-- Freshness bookkeeping for the app-level mailing scan (keyword + AI).
--
-- The pg_cron job (mqa_detect_mailings_2h) covers keyword-only detection in
-- SQL; the app's scan additionally sends keyword-missed messages to Claude.
-- Every completed app scan upserts its period row here, and the Scoring page
-- checks ran_at on load: older than 2 hours → a fresh background scan is
-- kicked off (src/lib/mailings-run.ts, maybeRefreshMailings). Without this
-- table the page cannot tell "scanned, nothing found" from "never scanned".

create table if not exists mqa_detect_runs (
  period           text primary key,           -- YYYYMM, e.g. '202607'
  ran_at           timestamptz not null default now(),
  messages_scanned integer,
  ai_classified    integer
);

alter table mqa_detect_runs enable row level security;

-- Same access model as mqa_chat_mailings: the app talks to this table with the
-- service-role key only; no anon policies.
