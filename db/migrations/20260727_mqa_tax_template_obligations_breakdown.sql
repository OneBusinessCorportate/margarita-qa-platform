-- ---------------------------------------------------------------------------
-- Tax notification → the real monthly OBLIGATIONS BREAKDOWN the accountants
-- actually send (verified against screenshots of live client chats): income
-- tax + social payment, stamp duty, salary, accounting-services fee, and total
-- obligations. The previous "отчёт сдан / налоги в банке" one-liner did not
-- match what clients receive.
--
-- The per-client, per-month amounts (income tax / stamp / salary / total) are
-- NOT stored in any accessible database — confirmed by searching the QA,
-- Artyom (ArmSoft/TaxService) and OneBusiness projects; only the services debt
-- (mqa_debts) and per-document invoice amounts exist. Owner decision: the
-- accountant fills these amounts each month. So the template ships the real
-- breakdown STRUCTURE with `___` fill fields; it stays MANUAL
-- (requires_attachment=true), so the bot never sends it until the accountant
-- has filled the numbers and marked it done. The services-fee period line is
-- pre-filled from {period}.
--
-- Salary (`salary:done:*`) and the services-payment reminder (`debts:req:*`)
-- are unchanged — they already match the real messages.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='mqa_notification_templates') then
    raise exception 'Prerequisite missing: apply 20260723_mqa_notifications_v1.sql first.';
  end if;
end $$;

update mqa_notification_templates set body =
$tpl$Налоги по состоянию на ___

Подоходный налог + соц. выплата — ___ драм
Гербовый сбор — ___ драм
Зарплата — ___ драм

Оплата бухгалтерских услуг ({period})
___ драм

Общие обязательства — ___ драм$tpl$,
title='Налоги — обязательства за период', updated_at=now() where id='main_taxes:req:ru';

update mqa_notification_templates set body =
$tpl$Հարկերը ___-ի դրությամբ

Եկամտային հարկ + սոց. վճար — ___ դրամ
Դրոշմանիշային — ___ դրամ
Աշխատավարձ — ___ դրամ

Հաշվապահական ծառայությունների վճար ({period})
___ դրամ

Ընդհանուր պարտավորություններ — ___ դրամ$tpl$,
title='Հարկեր — պարտավորություններ', updated_at=now() where id='main_taxes:req:hy';

update mqa_notification_templates set body =
$tpl$Taxes as of ___

Income tax + social payment — ___ AMD
Stamp duty — ___ AMD
Salary — ___ AMD

Accounting services fee ({period})
___ AMD

Total obligations — ___ AMD$tpl$,
title='Taxes — obligations for the period', updated_at=now() where id='main_taxes:req:en';
