-- ---------------------------------------------------------------------------
-- Маргарита: 4 нужных чата держим в платформе (Active), остальные неактивные —
-- убираем. Всё сохраняется в mqa_backup_20260713_inactive_* (восстановимо).
-- ---------------------------------------------------------------------------
update mqa_chats set status = 'Active' where agr_no in ('B-4061','B-4206');
insert into mqa_chats (agr_no, chat_name, status) values
  ('B-4859', 'B-4859 «Տերրաքոր Սուլյուշնս» ООО, AM', 'Active'),
  ('B-4809', 'B-4809 «ՍՊԸ Իմ Ջուր», AM', 'Active')
on conflict (agr_no) do update set status = 'Active';

create table if not exists mqa_backup_20260713_inactive_chats       as select * from mqa_chats        where false;
create table if not exists mqa_backup_20260713_inactive_evaluations as select * from mqa_evaluations  where false;
create table if not exists mqa_backup_20260713_inactive_mailings    as select * from mqa_chat_mailings where false;
insert into mqa_backup_20260713_inactive_chats       select * from mqa_chats         where status = 'Inactive';
insert into mqa_backup_20260713_inactive_evaluations select e.* from mqa_evaluations e where e.chat_agr_no in (select agr_no from mqa_chats where status='Inactive');
insert into mqa_backup_20260713_inactive_mailings    select m.* from mqa_chat_mailings m where m.agr_no    in (select agr_no from mqa_chats where status='Inactive');

delete from mqa_evaluations    where chat_agr_no    in (select agr_no from mqa_chats where status='Inactive');
delete from mqa_tasks          where chat_agr_no    in (select agr_no from mqa_chats where status='Inactive');
delete from mqa_chat_mailings  where agr_no         in (select agr_no from mqa_chats where status='Inactive');
delete from mqa_chat_activity  where agr_no         in (select agr_no from mqa_chats where status='Inactive');
delete from mqa_active_inclusions where agr_no      in (select agr_no from mqa_chats where status='Inactive');
delete from mqa_active_exclusions where agr_no      in (select agr_no from mqa_chats where status='Inactive');
delete from sqa_reviews        where company_agr_no in (select agr_no from mqa_chats where status='Inactive');
delete from mqa_chats          where status = 'Inactive';
