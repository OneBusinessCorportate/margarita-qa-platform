-- ---------------------------------------------------------------------------
-- Manual chat-score overrides + full edit history (Маргарита, п.8).
--
-- Problem: a chat's score for a PAST day could not be changed after the fact,
-- and there was no record of who changed a score, when, or why. The scoring
-- page already lets you re-open any date and re-save the evaluation, but that
-- silently mutates total_score with no audit trail and no "изменено вручную"
-- marker in the dashboard / PDF.
--
-- This table is APPEND-ONLY: every manual edit inserts a new row. The LATEST
-- row per (chat_agr_no, score_date) is the effective manual score; the older
-- rows are the history (кто изменил, когда, старая оценка, новая, комментарий).
-- A manual override takes priority over the automatically-computed evaluation
-- total for that (chat, day) everywhere it is shown.
-- ---------------------------------------------------------------------------

create table if not exists mqa_chat_score_overrides (
  id           text primary key default gen_random_uuid()::text,
  chat_agr_no  text not null references mqa_chats(agr_no) on delete cascade,
  client_name  text,                       -- snapshot of the client/chat name
  score_date   date not null,              -- the day whose score is overridden
  old_score    double precision,           -- score before this edit (audit)
  new_score    double precision not null,  -- the manual score, 0..100
  changed_by   text,                        -- editor's email / name
  comment      text not null,              -- required justification for the edit
  created_at   timestamptz not null default now()
);

-- Latest-override-per-day lookups + history ordering both use this index.
create index if not exists mqa_chat_score_overrides_lookup_idx
  on mqa_chat_score_overrides (chat_agr_no, score_date, created_at desc);

-- Service-role-only, like every other mqa_ table (the app uses the service key).
alter table mqa_chat_score_overrides enable row level security;
