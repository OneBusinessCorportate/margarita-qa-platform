-- Add chats that are missing from the platform but exist in production.
-- Run this in your Supabase SQL editor (or via psql) when a chat is not found
-- on the platform despite existing in Telegram.
--
-- B-4804 ИП Сергей Даций RU — reported missing 2026-06-24.
INSERT INTO mqa_chats (
  agr_no,
  chat_name,
  chat_link,
  status,
  accountant
)
VALUES (
  'B-4804',
  'ИП Сергей Даций RU',
  'https://web.telegram.org/a/#-5446631109',
  'Active',
  NULL  -- assign the responsible accountant here, e.g. 'Լիլիթ Ք.'
)
ON CONFLICT (agr_no) DO UPDATE
  SET chat_link = EXCLUDED.chat_link,
      status    = EXCLUDED.status;

-- B-4600 Ермилов Владимир Алексеевич (ИП, RU) — reported missing 2026-06-26.
-- Data taken from Margarita's «Чаты» export (row 845).
-- NOTE: in that sheet the chat's contract № (col A) is 'B-4599' while the chat
-- NAME reads 'B-4600'. agr_no is the primary key that mqa_violations join on
-- (c.agr_no = v.chat_agr_no), so it must match her violation rows. We use
-- B-4599 (the sheet's actual contract №); switch to 'B-4600' if the QA data
-- keys this chat as 4600.
INSERT INTO mqa_accountants (name)
VALUES ('Ստելլա')
ON CONFLICT (name) DO NOTHING;

INSERT INTO mqa_chats (
  agr_no,
  hvhh,
  name_agr,
  name_tax,
  status,
  tax_activation_date,
  chat_name,
  chat_link,
  accountant,
  created_date
)
VALUES (
  'B-4599',
  '20270701',
  'VLADMIR YERMILOV',
  'ՎԼԱԴԻՄԻՐ ԵՐՄԻԼՈՎ',
  'Active',
  '2026-05-02',
  'B-4600 <Ермилов Владимир Алексеевич> ИП RU',
  'https://web.telegram.org/a/#-5132962384',
  'Ստելլա',
  '2026-05-07'
)
ON CONFLICT (agr_no) DO UPDATE
  SET chat_link = EXCLUDED.chat_link,
      status    = EXCLUDED.status,
      chat_name = EXCLUDED.chat_name;
