-- ---------------------------------------------------------------------------
-- Add chats that were missing from the platform so QA can be done on them
-- (Маргарита: «Этих чатов нет в платформе — я не могу провести по ним QA»).
--
-- Данные предоставлены QA. Telegram chat id — число после # в
-- web.telegram.org/a/#<id>. Главный бухгалтер (head accountant) у всех троих —
-- Emiliya (Էմիлyա); в mqa_chats нет отдельной колонки под гл. бухгалтера,
-- поэтому фиксируем его здесь, в комментарии (как и в предыдущей такой миграции).
--
--   -5238562565  → B-4463  «<Միеն Թ> ՍՊԸ ENG»              бух. Օլյա,   менеджеры: Shogher, manager_onebusiness
--   -5449984289  → B-4845  «<Արվս Իմփлойմенթ Գրуп> ՍՊԸ AM» бух. Դավիթ,  менеджеры: manager_onebusiness, Shogher
--   -5080353975  → (без №) «ԱՁ Համлет Անդриասян-Gortsup»    бух. Ստելла, менеджер:  manager_onebusiness
--
-- У третьего чата нет номера договора — ключ agr_no генерируем из Telegram-id
-- так же, как это делает приложение при ручном добавлении по ссылке (TG<id>),
-- чтобы повторное добавление по ссылке в приложении дедуплицировалось.
-- Идемпотентно: ON CONFLICT (agr_no) DO NOTHING.
-- ---------------------------------------------------------------------------

insert into mqa_chats (agr_no, chat_name, chat_link, status, accountant, manager, created_date)
values
  ('B-4463', 'B-4463 <Միеն Թ> ՍՊԸ ENG',
   'https://web.telegram.org/a/#-5238562565', 'Active', 'Օլյա', 'Shogher, manager_onebusiness', current_date),
  ('B-4845', 'B-4845 <Արվս Իմփլոյմենթ Գրուփ> ՍՊԸ AM',
   'https://web.telegram.org/a/#-5449984289', 'Active', 'Դավիթ', 'manager_onebusiness, Shogher', current_date),
  ('TG-5080353975', 'ԱՁ Համլետ Անդրիասյան-Gortsup',
   'https://web.telegram.org/a/#-5080353975', 'Active', 'Ստելլա', 'manager_onebusiness', current_date)
on conflict (agr_no) do nothing;
