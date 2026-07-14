-- ---------------------------------------------------------------------------
-- Апелляции из формы обратной связи бухгалтеров (kk_accountant_feedback).
--
-- Тикеты формы обратной связи (situation_comment / solution_comment по
-- проблеме) — это апелляции, но раньше они не попадали в раздел «Апелляции»
-- Маргариты (страница читает только kk_problem_appeals). Теперь они
-- отображаются, а решение Маргариты сохраняется как строка в kk_problem_appeals
-- с указанием источника — чтобы не терять оригинальный ID тикета и не создавать
-- дубли при повторном импорте.
--
-- Добавляем к kk_problem_appeals два поля происхождения и уникальный индекс по
-- source_id (защита от дублирующего импорта). Идемпотентно.
-- ---------------------------------------------------------------------------
alter table kk_problem_appeals add column if not exists source text;
alter table kk_problem_appeals add column if not exists source_id text;

create unique index if not exists kk_problem_appeals_source_id_uidx
  on kk_problem_appeals (source_id)
  where source_id is not null;
