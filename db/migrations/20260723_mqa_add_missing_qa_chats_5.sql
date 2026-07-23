-- ---------------------------------------------------------------------------
-- Add chats that were missing from the platform so QA can be done on them
-- (Маргарита: «Этих чатов нет в платформе — я не могу провести по ним QA»,
--  2026-07-23).
--
-- Telegram chat id — число после «#» в web.telegram.org/{a,k}/#<id>. Главный
-- бухгалтер (head accountant) у всех пяти — Emiliya; в mqa_chats нет отдельной
-- колонки под гл. бухгалтера, поэтому фиксируем его здесь, в комментарии (как и
-- в предыдущих таких миграциях).
--
-- Ответственный бухгалтер записан в канонической локализованной форме, которая
-- резолвится через kk_accountant_aliases → employees (совпадает с уже
-- существующими в mqa_chats значениями):
--   Լիլիթ Ք․  → Lilit Kyababchyan (@LilithAccounting)  ← «обычная» Лилит
--   Թագուհի   → Taguhi Ghahramanyan (@AccountingTaguhi)
--   Հասմիկ    → Hasmik
--
--   -5215596601 → B-4880  «<Уразов Наиль Гильманович> ИП RU»  бух. Լիլիթ Ք․, менеджер: Shogher
--   -5256421141 → B-4879  «<Родионова Дарья Евгеньевна> ИП»   бух. Լիլիթ Ք․, менеджер: Shogher
--   -5526633939 → B-4829  «ИП Утрушкин Антон RU»              бух. Լիլիթ Ք․, менеджер: manager_onebusiness
--   -5174371801 → B-4730  «ИП Кшнякина Екатерина RU»          бух. Թագուհի, менеджер: manager_onebusiness
--   -4644154729 → N-1574  «Արման Թումանյան ԱՁ AM»             бух. Հասմիկ, менеджер: manager_onebusiness
--
-- Идемпотентно: ON CONFLICT (agr_no) DO UPDATE обновляет ссылку/статус/бухгалтера/
-- менеджера, чтобы повторный прогон чинил данные, но не плодил дубликаты.
-- ---------------------------------------------------------------------------

insert into mqa_chats (agr_no, chat_name, chat_link, status, accountant, manager, created_date)
values
  ('B-4880', 'B-4880 <Уразов Наиль Гильманович> ИП RU',
   'https://web.telegram.org/k/#-5215596601', 'Active', 'Լիլիթ Ք․', 'Shogher', current_date),
  ('B-4879', 'B-4879 <Родионова Дарья Евгеньевна> ИП',
   'https://web.telegram.org/k/#-5256421141', 'Active', 'Լիլիթ Ք․', 'Shogher', current_date),
  ('B-4829', 'B-4829 ИП Утрушкин Антон RU',
   'https://web.telegram.org/k/#-5526633939', 'Active', 'Լիլիթ Ք․', 'manager_onebusiness', current_date),
  ('B-4730', 'B-4730 ИП Кшнякина Екатерина RU',
   'https://web.telegram.org/k/#-5174371801', 'Active', 'Թագուհի', 'manager_onebusiness', current_date),
  ('N-1574', 'N-1574 Արման Թումանյան ԱՁ AM',
   'https://web.telegram.org/k/#-4644154729', 'Active', 'Հասմիկ', 'manager_onebusiness', current_date)
on conflict (agr_no) do update
  set chat_name  = excluded.chat_name,
      chat_link  = excluded.chat_link,
      status     = 'Active',
      accountant = excluded.accountant,
      manager    = excluded.manager;
