-- ---------------------------------------------------------------------------
-- Add chats that were missing from the platform so QA can be done on them
-- (Маргарита: «Этих чатов нет в платформе — я не могу провести по ним QA»,
--  2026-07-22).
--
-- Telegram chat id — число после «#» в web.telegram.org/{a,k}/#<id>. Главный
-- бухгалтер (head accountant) у всех пяти — Emiliya (Էмиլия); в mqa_chats нет
-- отдельной колонки под гл. бухгалтера, поэтому фиксируем его здесь, в
-- комментарии (как и в предыдущих таких миграциях).
--
-- Ответственный бухгалтер записан в канонической локализованной форме, которая
-- резолвится через kk_accountant_aliases → employees:
--   Թագուհի        → Taguhi Ghahramanyan  (@AccountingTaguhi)
--   Դավիթ          → Davit Aloyan         (@DavitAccounting1)
--   Լիլիթ          → Lilit Khosrovyan     (@LilitAccounting)   ← «@LilitAccounting»
--   Լիլիթ Ք․       → Lilit Kyababchyan    (@LilithAccounting)  ← «обычная» Лилит
--
--   -5135536623 → B-4452  «ООО АСВПВТ RU»               бух. Թագուհի, менеджер: manager_onebusiness
--                 (в чате подтверждено сообщениями: accountant = Taguhi Accounting)
--   -5052757125 → B-4145  «<Նաիրա Տեր-Ասատրյան> ԱՁ ARM» бух. Թագուհի, менеджер: Shogher
--                 (в чате подтверждено: accountant = Taguhi Accounting, head = Emiliya)
--   -5121332151 → B-4875  «<Вебпортал ЭФ> ООО RU»       бух. Լիլիթ Ք․ (обычная Лилит),
--                 менеджеры: manager_onebusiness, Shogher
--   -5512759821 → B-4830  «ԱՁ Լուսինե Վարդանյան AM»     бух. Դավիթ, менеджер: manager_onebusiness
--   -5506479202 → B-4864  «<Սառ Մեդ> ՍՊԸ AM»            бух. Լիլիթ (@LilitAccounting,
--                 НЕ обычная Лилит), менеджеры: manager_onebusiness, Shogher
--
-- Идемпотентно: ON CONFLICT (agr_no) DO UPDATE обновляет ссылку/статус/бухгалтера/
-- менеджера, чтобы повторный прогон чинил данные, но не плодил дубликаты.
-- ---------------------------------------------------------------------------

insert into mqa_chats (agr_no, chat_name, chat_link, status, accountant, manager, created_date)
values
  ('B-4452', 'B-4452 ООО АСВПВТ RU',
   'https://web.telegram.org/k/#-5135536623', 'Active', 'Թագուհի', 'manager_onebusiness', current_date),
  ('B-4145', 'B-4145 <Նաիրա Տեր-Ասատրյան> ԱՁ ARM',
   'https://web.telegram.org/k/#-5052757125', 'Active', 'Թագուհի', 'Shogher', current_date),
  ('B-4875', 'B-4875 <Вебпортал ЭФ> ООО RU',
   'https://web.telegram.org/k/#-5121332151', 'Active', 'Լիլիթ Ք․', 'manager_onebusiness, Shogher', current_date),
  ('B-4830', 'B-4830 ԱՁ Լուսինե Վարդանյան AM',
   'https://web.telegram.org/k/#-5512759821', 'Active', 'Դավիթ', 'manager_onebusiness', current_date),
  ('B-4864', 'B-4864 <Սառ Մեդ> ՍՊԸ AM',
   'https://web.telegram.org/k/#-5506479202', 'Active', 'Լիլիթ', 'manager_onebusiness, Shogher', current_date)
on conflict (agr_no) do update
  set chat_name  = excluded.chat_name,
      chat_link  = excluded.chat_link,
      status     = 'Active',
      accountant = excluded.accountant,
      manager    = excluded.manager;
