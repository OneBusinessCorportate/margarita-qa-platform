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
