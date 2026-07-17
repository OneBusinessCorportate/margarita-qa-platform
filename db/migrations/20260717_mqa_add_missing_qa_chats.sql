-- ---------------------------------------------------------------------------
-- Add / repair chats that were missing from the platform so QA can be done on
-- them (Маргарита: «Этих чатов нет в платформе — я не могу провести по ним QA»).
--
-- Telegram chat ids (the number after # in web.telegram.org/a/#<id>):
--   -5556488919, -5351039417, -5484916403  → not in mqa_chats at all → INSERT
--   -5248512177  → present but BROKEN: its agr_no is the full chat title and
--                  chat_link is NULL, so mqa_detect_mailings (which needs
--                  chat_link to extract the chat id) and last-activity refresh
--                  skipped it. We only SET its chat_link — the agr_no is left
--                  as-is because existing evaluations already reference it.
--
-- The three inserted rows use the same «TG<id>» placeholder agr_no that the
-- in-app «добавить чат по ссылке» flow (createChatFromLink) uses, so they show
-- up for QA immediately. Fill in the real contract № / name / accountant later
-- via the chat card (reconcile flags them as «нет настоящего № договора»).
-- Idempotent: on conflict (agr_no) do nothing / guarded update.
-- ---------------------------------------------------------------------------

-- 1) Repair the Гончар chat: give it its Telegram link so рассылки + activity
--    are auto-pulled from now on (accountant Թագուհի, already set).
update mqa_chats
   set chat_link = 'https://web.telegram.org/a/#-5248512177'
 where agr_no = 'ИП Гончар Александр/ 4345 RU'
   and chat_link is null;

-- 2) Insert the three chats that were entirely absent.
insert into mqa_chats (agr_no, chat_name, chat_link, status, accountant, created_date)
values
  ('TG-5556488919', 'Чат Telegram #-5556488919 (добавлен вручную для QA)',
   'https://web.telegram.org/a/#-5556488919', 'Active', null, current_date),
  ('TG-5351039417', 'Чат Telegram #-5351039417 (добавлен вручную для QA)',
   'https://web.telegram.org/a/#-5351039417', 'Active', null, current_date),
  ('TG-5484916403', 'Чат Telegram #-5484916403 (добавлен вручную для QA)',
   'https://web.telegram.org/a/#-5484916403', 'Active', null, current_date)
on conflict (agr_no) do nothing;
