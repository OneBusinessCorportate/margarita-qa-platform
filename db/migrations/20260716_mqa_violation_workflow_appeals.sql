-- ---------------------------------------------------------------------------
-- Рабочий цикл нарушений: «Ознакомлен» + апелляции, привязанные к нарушению.
--
-- Что / зачем / результат:
--   • Что: добавляем в mqa_violations статус рабочего цикла + фиксацию
--     ознакомления, и заводим отдельную таблицу mqa_violation_appeals для
--     апелляций бухгалтеров, связанных с конкретным нарушением (FK).
--   • Зачем: платформа должна довести цикл до конца — бухгалтер либо знакомится
--     с нарушением, либо подаёт апелляцию; Маргарита принимает/отклоняет; всё
--     сохраняется и попадает в отчёты (веб + Telegram).
--   • Результат: нарушение хранит свой статус и время ознакомления; апелляция —
--     свой текст/решение; одно нарушение не может иметь двух активных апелляций
--     (частичный уникальный индекс); история сохраняется.
--
-- Неразрушающая миграция: только add column if not exists / create table if
-- not exists. Существующие данные сохраняются, статусы backfill-ятся из старого
-- appeal_status.
-- ---------------------------------------------------------------------------

-- 1. Нарушения: рабочий статус + ознакомление ------------------------------
alter table mqa_violations add column if not exists confirmed       boolean not null default true;
alter table mqa_violations add column if not exists appeal_status    text;  -- null | 'appealed' | 'approved' | 'rejected'
alter table mqa_violations add column if not exists status           text not null default 'new';
alter table mqa_violations add column if not exists acknowledged_at  timestamptz;
alter table mqa_violations add column if not exists acknowledged_by  text;

-- Backfill статуса из легаси appeal_status для существующих строк (идемпотентно:
-- трогаем только строки, ещё оставшиеся в 'new').
update mqa_violations set status = 'appealed'        where status = 'new' and appeal_status = 'appealed';
update mqa_violations set status = 'appeal_approved' where status = 'new' and appeal_status = 'approved';
update mqa_violations set status = 'appeal_rejected' where status = 'new' and appeal_status = 'rejected';

-- Единый набор значений статуса (Phase 11). Через триггерную проверку не идём —
-- достаточно CHECK. Добавляем без валидации существующих строк на случай грязных
-- легаси-значений, но они уже нормализованы выше.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'mqa_violations_status_check'
  ) then
    alter table mqa_violations
      add constraint mqa_violations_status_check
      check (status in ('new','acknowledged','appealed','appeal_approved','appeal_rejected'));
  end if;
end $$;

-- Индексы под фильтры отчётов (статус, бухгалтер, дата).
create index if not exists mqa_violations_status_idx     on mqa_violations (status);
create index if not exists mqa_violations_accountant_idx on mqa_violations (accountant);
create index if not exists mqa_violations_vdate_idx       on mqa_violations (vdate);

-- 2. Апелляции, привязанные к нарушению -------------------------------------
create table if not exists mqa_violation_appeals (
  id               text primary key default gen_random_uuid()::text,
  violation_id     text not null references mqa_violations(id) on delete cascade,
  accountant       text,
  appeal_text      text not null,
  status           text not null default 'pending'
                   check (status in ('pending','approved','rejected')),
  decision_comment text,
  resolved_by      text,
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz
);

create index if not exists mqa_violation_appeals_violation_idx
  on mqa_violation_appeals (violation_id);
create index if not exists mqa_violation_appeals_status_idx
  on mqa_violation_appeals (status);
create index if not exists mqa_violation_appeals_accountant_idx
  on mqa_violation_appeals (accountant);
create index if not exists mqa_violation_appeals_created_idx
  on mqa_violation_appeals (created_at desc);

-- Запрет двух активных (pending) апелляций на одно нарушение — на уровне БД.
create unique index if not exists mqa_violation_appeals_one_pending
  on mqa_violation_appeals (violation_id)
  where status = 'pending';

alter table mqa_violation_appeals enable row level security;
