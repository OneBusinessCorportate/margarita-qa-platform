-- ---------------------------------------------------------------------------
-- Add / repair chats that were missing from the platform so QA can be done on
-- them (Маргарита: «Этих чатов нет в платформе — я не могу провести по ним QA»).
--
-- Telegram chat ids (the number after # in web.telegram.org/a/#<id>) and their
-- real contract data (provided by Маргарита):
--   -5248512177  → «ИП Гончар Александр/ 4345 RU»            бух. Թагуhi (Թագուհի)
--   -5351039417  → B-4805  «ООО Нева Сизонс Глобал Трэвел RU» бух. Դավիթ
--   -5484916403  → B-4809  «ՍՊԸ Իմ Ջուր, AM»                 бух. Դավիթ
--   -5556488919  → В-4833  «ИП Манохина Вера RU»             бух. Լիլիթ
-- Manager for all four: manager_onebusiness; head accountant: Emiliya (Էմիլյա).
--
-- The Гончар and B-4809 rows already existed but with chat_link = NULL, so
-- mqa_detect_mailings (needs chat_link to extract the chat id) and the
-- last-activity refresh skipped them → they never surfaced. We set the link and
-- the accountant/manager. B-4805 and В-4833 were entirely absent → inserted.
-- Idempotent: inserts use ON CONFLICT DO NOTHING; the updates only fill blanks.
-- ---------------------------------------------------------------------------

-- Гончар — уже есть строка (agr_no = полное название), проставляем ссылку и роли.
update mqa_chats
   set chat_link = coalesce(chat_link, 'https://web.telegram.org/a/#-5248512177'),
       accountant = coalesce(accountant, 'Թագուհի'),
       manager    = coalesce(manager, 'manager_onebusiness')
 where agr_no = 'ИП Гончар Александр/ 4345 RU';

-- B-4809 — контракт уже был (без ссылки), подключаем Telegram-чат и роли.
update mqa_chats
   set chat_link = coalesce(chat_link, 'https://web.telegram.org/a/#-5484916403'),
       accountant = coalesce(accountant, 'Դավիթ'),
       manager    = coalesce(manager, 'manager_onebusiness')
 where agr_no = 'B-4809';

-- B-4805 и В-4833 — новых контрактов не было, добавляем.
insert into mqa_chats (agr_no, chat_name, chat_link, status, accountant, manager, created_date)
values
  ('B-4805', 'ООО Нева Сизонс Глобал Трэвел RU',
   'https://web.telegram.org/a/#-5351039417', 'Active', 'Դավիթ', 'manager_onebusiness', current_date),
  ('В-4833', 'ИП Манохина Вера RU',
   'https://web.telegram.org/a/#-5556488919', 'Active', 'Լիլիթ', 'manager_onebusiness', current_date)
on conflict (agr_no) do nothing;
