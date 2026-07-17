-- ---------------------------------------------------------------------------
-- Отдельный трекер «Системные задачи бухгалтеров» (п.6).
--
-- Что / зачем / результат:
--   • Что: заводим ОТДЕЛЬНУЮ таблицу mqa_accountant_system_tasks для системных
--     задач бухгалтеров — НЕ смешанную с апелляциями (mqa_violation_appeals) и
--     не с общими задачами по чатам (mqa_tasks).
--   • Зачем: по QA-тикету Маргариты может требоваться действие бухгалтера
--     («поставить задачу в очередь»); эти задачи нужно вести отдельным списком
--     со своим жизненным циклом (new → in_progress → postponed → completed /
--     cancelled), опционально связанные с QA-тикетом (mqa_violations.id).
--   • Результат: задачи хранят свой статус, приоритет, сроки (original /
--     postponed), исполнителя-бухгалтера, автора и время выполнения; связь с
--     QA-тикетом мягкая (on delete set null) — удаление нарушения не удаляет
--     задачу, а лишь снимает ссылку.
--
-- Неразрушающая миграция: только create table / index if not exists.
-- ---------------------------------------------------------------------------

create table if not exists mqa_accountant_system_tasks (
  id                 text primary key default gen_random_uuid()::text,
  -- Связанный QA-тикет (нарушение). NULL — задача без привязки к тикету.
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
create index if not exists mqa_ast_created_idx      on mqa_accountant_system_tasks (created_at desc);

-- Keep updated_at fresh on every change (mirrors the app-level bump, so direct
-- SQL edits stay consistent too).
create or replace function mqa_ast_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists mqa_ast_touch on mqa_accountant_system_tasks;
create trigger mqa_ast_touch
  before update on mqa_accountant_system_tasks
  for each row execute function mqa_ast_touch_updated_at();

alter table mqa_accountant_system_tasks enable row level security;
