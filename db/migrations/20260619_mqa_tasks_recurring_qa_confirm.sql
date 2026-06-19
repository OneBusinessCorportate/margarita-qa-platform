-- Tasks: deadline-bound follow-ups + recurring / non-closable tasks (items 7, 8
-- and the boss's notes).
--
-- WHY
-- ---
--   • Item 8: "бухгалтер сказал клиенту, что вернётся через 2 дня" — that is a
--     task with a hard due date, not an unanswered chat. The Задачи feature
--     already stores due_date_original; we just surface and track it.
--   • Boss note 2: "Незакрываемые или повторяющиеся задачи — пока бухгалтер это
--     не сделает и QA не подтвердит, что бухгалтер это сделал." A recurring task
--     stays OPEN until BOTH the accountant marks it done AND QA confirms it.
--
-- Adds two flags to mqa_tasks. Idempotent: safe to re-run.

alter table mqa_tasks add column if not exists recurring        boolean not null default false;
alter table mqa_tasks add column if not exists qa_confirmed      boolean not null default false;
alter table mqa_tasks add column if not exists qa_confirmed_at   timestamptz;
alter table mqa_tasks add column if not exists qa_confirmed_by   text;

-- Open recurring tasks (done by the accountant but not yet QA-confirmed, or not
-- done at all) are what Margarita chases — index for the "только открытые" view.
create index if not exists mqa_tasks_open_idx
  on mqa_tasks (qa_confirmed, task_status);
