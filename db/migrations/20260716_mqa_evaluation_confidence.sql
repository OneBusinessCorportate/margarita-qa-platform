-- ---------------------------------------------------------------------------
-- Фича «Уверенность модели» (Model-confidence tracking & analytics).
--
-- Расширяет СУЩЕСТВУЮЩУЮ таблицу оценок mqa_evaluations (переиспользуем сущность,
-- не заводим новую) полями, которые:
--   • хранят уверенность модели в ИСХОДНОЙ AI-оценке (0..100, %);
--   • дублируют исходную общую оценку AI в колонку для быстрой аналитики;
--   • фиксируют статус проверки Маргаритой (не проверено / принято / исправлено)
--     и кто/когда провёл проверку.
--
-- Совместимость и сохранность данных:
--   • все колонки NULLABLE (кроме review_status с DEFAULT) — существующие строки
--     остаются валидными и не меняются;
--   • ai_confidence = NULL у легаси-строк ⇒ трактуется как «Нет данных», НЕ 0%;
--     такие строки исключаются из расчётов на основе уверенности;
--   • исходный AI-снимок дополнительно хранится в scores->'ai' (JSON) и НЕ
--     перезаписывается при ручной правке — финал Маргариты пишется в остальные
--     поля scores + total_score;
--   • дубли «записей проверки» уже исключены уникальным ключом
--     (chat_agr_no, checking_date, role): одна строка-оценка на роль в день.
-- Запускать в Supabase SQL editor (или psql с DATABASE_URL). Идемпотентно.
-- ---------------------------------------------------------------------------

alter table mqa_evaluations
  add column if not exists ai_confidence double precision;

alter table mqa_evaluations
  add column if not exists ai_total double precision;

alter table mqa_evaluations
  add column if not exists review_status text not null default 'not_reviewed';

alter table mqa_evaluations
  add column if not exists reviewed_by text;

alter table mqa_evaluations
  add column if not exists reviewed_at timestamptz;

-- Допустимые статусы проверки. Добавляем через DO-блок, чтобы повторный запуск
-- не падал на уже существующем ограничении.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'mqa_evaluations_review_status_chk'
  ) then
    alter table mqa_evaluations
      add constraint mqa_evaluations_review_status_chk
      check (review_status in ('not_reviewed', 'accepted', 'corrected'));
  end if;
end $$;

-- Диапазон уверенности: значение всегда 0..100 (либо NULL = нет данных).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'mqa_evaluations_ai_confidence_chk'
  ) then
    alter table mqa_evaluations
      add constraint mqa_evaluations_ai_confidence_chk
      check (ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 100));
  end if;
end $$;

-- Индексы под аналитику по уверенности/статусу (отчёт фильтрует по ним).
create index if not exists mqa_evaluations_review_status_idx
  on mqa_evaluations (review_status);
create index if not exists mqa_evaluations_ai_confidence_idx
  on mqa_evaluations (ai_confidence);
