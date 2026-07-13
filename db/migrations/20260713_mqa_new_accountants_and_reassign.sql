-- ---------------------------------------------------------------------------
-- Issue 1 (Маргарита): new accountants + fix wrongly-assigned chats.
--
-- The July-10 reconcile copied a stale «Основные данные» snapshot verbatim,
-- leaving these chats on Лилит/Сатеник. Per the current Excel files they belong
-- to Марианна / Артур / Алиса. We add the two missing accountants (Артур is in
-- valid-employees.ts but was not in the DB) so the FK holds, then reassign the
-- 5 chats she named. Armenian names are written with chr() codepoints so the
-- migration text is byte-exact (no Cyrillic/Armenian homoglyph drift).
--   Մարիաննա  = chr(1348,1377,1408,1387,1377,1398,1398,1377)
--   Ալիսա     = chr(1329,1388,1387,1405,1377)
--   Արթուր     = chr(1329,1408,1385,1400,1410,1408)
-- ---------------------------------------------------------------------------
insert into mqa_accountants (name, active, role) values
  (chr(1348)||chr(1377)||chr(1408)||chr(1387)||chr(1377)||chr(1398)||chr(1398)||chr(1377), true, 'accountant'),
  (chr(1329)||chr(1388)||chr(1387)||chr(1405)||chr(1377),                                  true, 'accountant'),
  (chr(1329)||chr(1408)||chr(1385)||chr(1400)||chr(1410)||chr(1408),                        true, 'accountant')
on conflict (name) do update set active = true, role = 'accountant';

update mqa_chats set accountant = chr(1348)||chr(1377)||chr(1408)||chr(1387)||chr(1377)||chr(1398)||chr(1398)||chr(1377) where agr_no in ('B-3862','B-4376');
update mqa_chats set accountant = chr(1329)||chr(1408)||chr(1385)||chr(1400)||chr(1410)||chr(1408)                       where agr_no in ('B-4273','180');
update mqa_chats set accountant = chr(1329)||chr(1388)||chr(1387)||chr(1405)||chr(1377)                                  where agr_no = ('В-4370');
