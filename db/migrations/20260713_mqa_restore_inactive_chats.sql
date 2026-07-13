-- ---------------------------------------------------------------------------
-- Issues 3 & 7 (Маргарита): the July-10 reconcile DELETED 212 chats it marked
-- Inactive (incl. B-4061, B-4206 she still needs), so they showed «Ничего не
-- найдено» when she tried to add them. Restore them from the recoverable
-- backup, but as status='Inactive' so they are findable / QA-able and clearly
-- marked (🚫 Неактивный badge on the scoring page), NOT counted as active.
-- Child rows (evaluations, mailings, sqa_reviews) are restored too for history.
-- on conflict do nothing → idempotent; anything re-created since is untouched.
--
-- Going forward, Inactive chats are MARKED, not deleted — no cron deletes them.
-- ---------------------------------------------------------------------------
insert into mqa_chats
      (agr_no,hvhh,name_agr,name_tax,status,tax_activation_date,chat_name,chat_link,
       accountant,manager,debts,created_date,last_activity_date,last_activity_at,
       last_sender_role,unanswered)
select agr_no,hvhh,name_agr,name_tax,'Inactive',tax_activation_date,chat_name,chat_link,
       accountant,manager,debts,created_date,last_activity_date,last_activity_at,
       last_sender_role,unanswered
from   mqa_backup_20260710_chats
on conflict (agr_no) do nothing;

insert into mqa_evaluations   select * from mqa_backup_20260710_evaluations   on conflict do nothing;
insert into mqa_chat_mailings select * from mqa_backup_20260710_chat_mailings on conflict do nothing;
insert into sqa_reviews       select * from mqa_backup_20260710_sqa_reviews   on conflict do nothing;
