-- Distinguish confirmed vs appealed violations (Маргарита). warning/penalty is
-- DERIVED from the fine (0 = предупреждение, > 0 = штраф) in violations.ts;
-- these columns add the workflow status.
alter table mqa_violations add column if not exists confirmed boolean not null default true;
alter table mqa_violations add column if not exists appeal_status text; -- null | 'appealed' | 'approved' | 'rejected'
