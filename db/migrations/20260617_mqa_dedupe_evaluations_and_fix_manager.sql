-- Data-correctness cleanup, all reversible.
--
-- 1) The xlsx importer INSERTed (not upserted) evaluations, so re-runs created
--    duplicate rows for the same (chat, date, role) — 176 groups / 178 extra
--    rows — which double-count in the daily report. We archive the extras to a
--    backup table, then keep only the MOST RECENT row per (chat, date, role)
--    (Margarita's latest judgment wins over the stale imported value).
-- 2) Add a unique constraint so duplicates can never recur (the app + importer
--    now upsert against it).
-- 3) The importer copied the accountant column into `manager` too, so every
--    chat's manager was wrong (= its accountant). Null those out (there is no
--    real manager column in the source); managers now come from real
--    manager-role evaluations. Value is trivially recoverable (it equalled
--    accountant), so no backup needed.
--
-- Idempotent enough to re-run: the backup insert/delete simply find nothing on
-- a second pass, and the constraint add is guarded by the prior run.

-- 1a) Archive the rows that will be deleted.
create table if not exists mqa_evaluations_dedup_backup
  (like mqa_evaluations including defaults);

insert into mqa_evaluations_dedup_backup
select e.*
from mqa_evaluations e
where e.id in (
  select id from (
    select id,
           row_number() over (
             partition by chat_agr_no, checking_date, role
             order by created_at desc, id desc
           ) rn
    from mqa_evaluations
  ) x
  where x.rn > 1
);

-- 1b) Delete the duplicates (keep the most recent per key).
delete from mqa_evaluations
where id in (
  select id from (
    select id,
           row_number() over (
             partition by chat_agr_no, checking_date, role
             order by created_at desc, id desc
           ) rn
    from mqa_evaluations
  ) x
  where x.rn > 1
);

-- 2) Prevent recurrence.
alter table mqa_evaluations
  add constraint mqa_evaluations_chat_date_role_key
  unique (chat_agr_no, checking_date, role);

-- 3) Clear the fabricated manager values.
update mqa_chats
set manager = null
where manager is not distinct from accountant;
