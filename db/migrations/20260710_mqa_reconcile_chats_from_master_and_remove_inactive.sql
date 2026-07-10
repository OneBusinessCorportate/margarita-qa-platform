-- ---------------------------------------------------------------------------
-- Reconcile chats + responsible accountants from the client's "One Business"
-- workbook (sheet «Основные данные», snapshot 2026-07-10) and remove Inactive
-- chats from the QA platform.
--
-- The workbook is now the source of truth for the chat list and each chat's
-- responsible accountant. Reconciling its master tab (columns: № договора,
-- Պայմանագրի կարգավիճակ = status, Бухгалтер = accountant) against mqa_chats
-- (941 rows) yields, for contracts present in both:
--   * 212 chats the sheet marks Inactive  -> removed here
--   * 21  chats whose responsible accountant changed in the sheet
--   * 3   chats the sheet marks Active but were Inactive in the DB -> reactivated
--
-- Per the data owner's decision, the sheet's «Бухгалтер» column is copied
-- VERBATIM — including 20 chats it reassigns to Սաթենիկ (who is not in the
-- app's approved 14 in valid-employees.ts). The dashboard still filters staff
-- through valid-employees, so those assignments are stored but excluded from
-- KPI/violation math. The 21st change fixes a spelling (Առփինե -> Արփինե).
--
-- Chats absent from the master tab (incl. manual QA chats like TG-*, T-2, and
-- newer clients) and one-time "Once" contracts are intentionally left untouched.
--
-- Every removed chat and its child rows (evaluations, tasks, mailings,
-- sqa_reviews) are copied into dated mqa_backup_20260710_* tables first, so the
-- deletion is fully recoverable. Runs in one transaction (apply_migration wraps
-- it); if any step fails, nothing changes.
-- ---------------------------------------------------------------------------

-- 0) FK safety. mqa_chats.accountant references mqa_accountants(name). The
--    correctly-spelled Արփինե (a valid current employee) is missing from this
--    database, so add it before assigning it. Սաթենիկ already exists.
insert into mqa_accountants (name, active, role)
select 'Արփինե', true, 'accountant'
where not exists (select 1 from mqa_accountants where name = 'Արփինե');

-- 1) The 212 contracts the sheet marks Inactive (present in mqa_chats).
create temporary table _del (agr_no text primary key) on commit drop;
insert into _del (agr_no) values ('100'),('1103'),('111'),('1116'),('1121'),('1122'),('1153'),('1186'),('120'),('1215'),('1332'),('1401'),('1430'),('1434'),('1545'),('1581'),('1586'),('1589'),('1591'),('1619'),('1780'),('194'),('197'),('199'),('221'),('248'),('282'),('30'),('3163'),('3165'),('3174'),('382'),('442'),('455'),('462'),('473'),('512'),('530'),('808'),('867'),('882'),('897'),('908'),('944'),('B-1707'),('B-1807'),('B-1825'),('B-3040'),('B-3041'),('B-3048'),('B-3049'),('B-3053'),('B-3074'),('B-3083'),('B-3084'),('B-3101'),('B-3171'),('B-3179'),('B-3224'),('B-3253'),('B-3262'),('B-3269'),('B-3271'),('B-3273'),('B-3274'),('B-3289'),('B-3298'),('B-3302'),('B-3310'),('B-3313'),('B-3314'),('B-3315'),('B-3318'),('B-3320'),('B-3336'),('B-3338'),('B-3352'),('B-3360'),('B-3386'),('B-3389'),('B-3390'),('B-3409'),('B-3415'),('B-3425'),('B-3429'),('B-3444'),('B-3448'),('B-3449'),('B-3451'),('B-3456'),('B-3462'),('B-3490'),('B-3528'),('B-3573'),('B-3582'),('B-3584'),('B-3591'),('B-3603'),('B-3604'),('B-3609'),('B-3611'),('B-3613'),('B-3621'),('B-3658'),('B-3660'),('B-3678'),('B-3684'),('B-3686'),('B-3691'),('B-3699'),('B-3709'),('B-3716'),('B-3721'),('B-3740'),('B-3743'),('B-3749'),('B-3750'),('B-3766'),('B-3767'),('B-3795'),('B-3807'),('B-3833'),('B-3835'),('B-3849'),('B-3850'),('B-3860'),('B-3873'),('B-3928'),('B-3959'),('B-3971'),('B-3985'),('B-3986'),('B-3988'),('B-4061'),('B-4076'),('B-4108'),('B-4128'),('B-4134'),('B-4144'),('B-4145'),('B-4180'),('B-4197'),('B-4201'),('B-4206'),('B-4234'),('B-4246'),('B-4294'),('B-4299'),('B-4300'),('B-4319'),('B-4361'),('B-4380'),('B-4399'),('B-4409'),('B-4461'),('B-4463'),('B-4502'),('N-4063'),('В-1509'),('В-1510'),('В-1511'),('В-1513'),('В-1709'),('В-2309'),('В-3794'),('В-3796'),('В-3822'),('В-3870'),('В-3874'),('В-3880'),('В-3891'),('В-3908'),('В-3919'),('В-3921'),('В-3922'),('В-3927'),('В-3935'),('В-3936'),('В-3947'),('В-3960'),('В-3962'),('В-3982'),('В-3992'),('В-4022'),('В-4050'),('В-4093'),('В-4094'),('В-4105'),('В-4110'),('В-4111'),('В-4159'),('В-4166'),('В-4173'),('В-4195'),('В-4202'),('В-4228'),('В-4229'),('В-4241'),('В-4243'),('В-4296'),('В-4328'),('В-4337'),('В-4342'),('В-4343'),('В-4344'),('В-4412'),('В-4432'),('В-4452'),('В-4541'),('В-4629'),('В-4663'),('В-6413');

-- 2) Recoverable backup of everything about to be deleted.
create table if not exists mqa_backup_20260710_chats         as select * from mqa_chats         where false;
create table if not exists mqa_backup_20260710_evaluations   as select * from mqa_evaluations   where false;
create table if not exists mqa_backup_20260710_tasks         as select * from mqa_tasks         where false;
create table if not exists mqa_backup_20260710_chat_mailings as select * from mqa_chat_mailings where false;
create table if not exists mqa_backup_20260710_sqa_reviews   as select * from sqa_reviews       where false;

insert into mqa_backup_20260710_chats         select c.* from mqa_chats c         where c.agr_no        in (select agr_no from _del);
insert into mqa_backup_20260710_evaluations   select e.* from mqa_evaluations e   where e.chat_agr_no   in (select agr_no from _del);
insert into mqa_backup_20260710_tasks         select t.* from mqa_tasks t         where t.chat_agr_no   in (select agr_no from _del);
insert into mqa_backup_20260710_chat_mailings select m.* from mqa_chat_mailings m where m.agr_no        in (select agr_no from _del);
insert into mqa_backup_20260710_sqa_reviews   select r.* from sqa_reviews r       where r.company_agr_no in (select agr_no from _del);

-- 3) Responsible-accountant changes (verbatim from the sheet), kept chats only.
update mqa_chats c
   set accountant = v.accountant
  from (values
    ('1527', 'Սաթենիկ'),
    ('1658', 'Սաթենիկ'),
    ('1660', 'Սաթենիկ'),
    ('6', 'Սաթենիկ'),
    ('610', 'Սաթենիկ'),
    ('640', 'Սաթենիկ'),
    ('917', 'Սաթենիկ'),
    ('B-3305', 'Սաթենիկ'),
    ('B-3322', 'Սաթենիկ'),
    ('B-3342', 'Սաթենիկ'),
    ('B-3375', 'Սաթենիկ'),
    ('B-4146', 'Սաթենիկ'),
    ('B-4273', 'Սաթենիկ'),
    ('B-4562', 'Սաթենիկ'),
    ('B-4577', 'Սաթենիկ'),
    ('T-1', 'Արփինե'),
    ('В-3868', 'Սաթենիկ'),
    ('В-3972', 'Սաթենիկ'),
    ('В-3989', 'Սաթենիկ'),
    ('В-4075', 'Սաթենիկ'),
    ('В-4083', 'Սաթենիկ')
  ) as v(agr_no, accountant)
 where c.agr_no = v.agr_no;

-- 4) Reactivate chats the sheet marks Active that were Inactive in the DB.
update mqa_chats set status = 'Active'
 where agr_no in ('B-4177', 'B-4661', 'В-4504') and status <> 'Active';

-- 5) Remove the Inactive chats — child rows first (FKs are ON DELETE NO ACTION).
delete from mqa_evaluations   where chat_agr_no    in (select agr_no from _del);
delete from mqa_tasks         where chat_agr_no    in (select agr_no from _del);
delete from mqa_chat_mailings where agr_no         in (select agr_no from _del);
delete from sqa_reviews       where company_agr_no in (select agr_no from _del);
delete from mqa_chats         where agr_no         in (select agr_no from _del);
