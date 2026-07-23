-- ---------------------------------------------------------------------------
-- Templated client notifications — plan → (optional edit/attach) → bot sends → log
--
-- WHY / the workflow flip. Today accountants send client mailings BY HAND and
-- the platform only SCANS their messages afterwards to detect what went out
-- (mqa_detect_mailings → mqa_chat_mailings). This migration adds the INVERSE
-- flow: the platform PLANS the upcoming notifications per company for the next
-- 30 days, the accountant SEES them (in the accountant app), may optionally
-- EDIT the text or ATTACH a document — and if they do nothing the BOT SENDS the
-- planned message on its schedule. Every actual send is LOGGED with its full
-- text. Templated client messages therefore go out ONLY via the bot, never
-- hand-typed.
--
-- This migration owns the SOURCE-OF-TRUTH tables (mqa_*). The accountant app
-- (kk-accountants-feedback-form) reads them through read-only `kk_*` views and
-- writes (edit/attach/approve/cancel) through SECURITY DEFINER `kk_*` RPCs —
-- both defined in that repo's migration 0035, exactly like the existing
-- mqa_violations ↔ kk_violation_workflow bridge (kk 0027 / repo #1
-- 20260716_mqa_violation_workflow_appeals.sql).
--
-- SAFETY. Wording is DRAFT until the owner approves it: seeded templates carry
-- `approved = false`, and the sender (scripts/send-notifications.ts) refuses to
-- send an un-approved template and is itself gated behind
-- NOTIFICATIONS_SEND_ENABLED — mirroring the "no-op until configured" posture of
-- the existing Telegram report schedules. Turning the flag + template approvals
-- on is the last step, done only after the owner signs off on the exact text.
-- ---------------------------------------------------------------------------

-- 0. Per-company language (pt.4) --------------------------------------------
-- Set once (default 'ru' — all standard wording is Russian-primary), manually
-- overridable per company. Templates render in this language.
-- BACKLOG (do NOT build now): detect chat-name changes and alert that the
-- platform language may need updating — tracked as a task, see the
-- mqa_notification_language_backlog note below.
alter table mqa_chats
  add column if not exists language text not null default 'ru'
  check (language in ('ru', 'hy', 'en', 'zh'));

comment on column mqa_chats.language is
  'Client-message language for templated notifications (pt.4). Set at company creation (default ru), manually overridable. BACKLOG: auto-detect from chat-name changes and alert.';

-- 1. Template catalog (pt.1) ------------------------------------------------
-- Promote the standard template wording out of the detection regexes into a
-- real data store: one row per (category, subtype, language) holding the actual
-- client-facing message text. `mode` tags AUTO (bot sends the fixed wording on
-- its own) vs MANUAL (accountant must attach a file / mark done first — the
-- salary ведомость, the tax report). This is the single source the bot sends
-- from.
create table if not exists mqa_notification_templates (
  id                  text primary key,             -- '<category>:<subtype>:<language>'
  category            text not null
                      check (category in ('main_taxes', 'salary', 'primary_docs', 'debts')),
  subtype             text not null
                      check (subtype in ('done', 'paid', 'call', 'req', 'neg')),
  language            text not null
                      check (language in ('ru', 'hy', 'en', 'zh')),
  mode                text not null
                      check (mode in ('auto', 'manual')),
  title               text not null,                -- short label for the UI
  body                text not null,                -- client-facing message text (with {placeholders})
  requires_attachment boolean not null default false,
  approved            boolean not null default false, -- owner must sign off before the bot sends
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (category, subtype, language)
);

alter table mqa_notification_templates enable row level security;

comment on table mqa_notification_templates is
  'Template catalog (pt.1): the client-facing message text per (category, subtype, language). mode=auto (bot sends fixed wording) | manual (needs an attached file/mark first). approved=false until the owner signs off on wording; the sender refuses un-approved templates.';

-- 2. Planned 30-day chain (pt.3) --------------------------------------------
-- One queued upcoming notification per (company, cycle, category, subtype).
-- Status 'planned' means "the bot WILL send this on scheduled_date unless it is
-- edited/cancelled" — matching the owner rule «if they don't edit, the bot
-- sends on its schedule». An edit keeps it scheduled but stamps who/when and is
-- also written to mqa_notification_edits (audit trail — no silent edits).
create table if not exists mqa_planned_notifications (
  id                  bigint generated always as identity primary key,
  agr_no              text not null references mqa_chats(agr_no),
  period              text not null,                -- YYYYMM mailing cycle (mailingPeriodOf)
  category            text not null,
  subtype             text not null,
  language            text not null,
  scheduled_date      date not null,                -- the day the bot will send
  template_id         text references mqa_notification_templates(id),
  mode                text not null,                -- 'auto' | 'manual' (from the template)
  requires_attachment boolean not null default false,
  rendered_text       text not null,                -- the exact message that WILL be sent
  accompanying_text   text,                         -- optional accompanying text (manual sections, pt.2)
  status              text not null default 'planned'
                      check (status in ('planned', 'edited', 'approved', 'cancelled', 'sent', 'skipped')),
  edited_by           text,
  edited_at           timestamptz,
  approved_by         text,
  approved_at         timestamptz,
  cancelled_by        text,
  cancelled_at        timestamptz,
  sent_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (agr_no, period, category, subtype)
);

alter table mqa_planned_notifications enable row level security;

create index if not exists mqa_planned_notifications_sched_idx
  on mqa_planned_notifications (scheduled_date);
create index if not exists mqa_planned_notifications_agr_idx
  on mqa_planned_notifications (agr_no);
create index if not exists mqa_planned_notifications_status_idx
  on mqa_planned_notifications (status);

comment on table mqa_planned_notifications is
  'Planned 30-day notification chain (pt.3): the upcoming messages the bot will send per company. status=planned/edited/approved all auto-send on scheduled_date; cancelled/sent/skipped do not. Edits are logged in mqa_notification_edits.';

-- 3. Edit audit trail (pt.3) ------------------------------------------------
-- Every last-minute change to a planned message is recorded here — who changed
-- what, when — so there are no silent/accidental edits.
create table if not exists mqa_notification_edits (
  id          bigint generated always as identity primary key,
  planned_id  bigint not null references mqa_planned_notifications(id) on delete cascade,
  action      text not null
              check (action in ('edit_text', 'attach', 'mark_done', 'approve', 'cancel', 'plan')),
  editor      text,
  old_text    text,
  new_text    text,
  note        text,
  created_at  timestamptz not null default now()
);

alter table mqa_notification_edits enable row level security;

create index if not exists mqa_notification_edits_planned_idx
  on mqa_notification_edits (planned_id);

comment on table mqa_notification_edits is
  'Audit trail (pt.3): who changed/approved/cancelled/attached to a planned notification, and when. Written by the kk_* RPCs (accountant app) and the planning cron.';

-- 4. Manual input: attachments by month (pt.2) ------------------------------
-- For MANUAL template types (salary ведомость, tax report), a place to attach a
-- file by month or just mark done, plus optional accompanying text. No free
-- "comment" field — file/mark + template text only.
create table if not exists mqa_notification_attachments (
  id           bigint generated always as identity primary key,
  agr_no       text not null references mqa_chats(agr_no),
  period       text not null,                       -- YYYYMM the file belongs to
  category     text not null,                       -- manual category (salary / main_taxes / ...)
  file_name    text,
  file_url     text,                                -- storage path / URL of the uploaded document
  marked_done  boolean not null default false,      -- accountant marked the manual step done without a file
  uploaded_by  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (agr_no, period, category)
);

alter table mqa_notification_attachments enable row level security;

comment on table mqa_notification_attachments is
  'Manual-input sections (pt.2): the monthly file (e.g. salary ведомость / tax report) or mark-done for MANUAL template types, plus optional accompanying text. One row per (company, period, category).';

-- 5. Sent-notifications log (pt.6) ------------------------------------------
-- Written by the bot when it actually sends. Deliberately NOT overloading
-- mqa_chat_mailings (which is detection-based and lacks the full text + subtype).
-- Columns required by the task: date, full text, type, subtype, contract number.
create table if not exists mqa_sent_notifications (
  id            bigint generated always as identity primary key,
  sent_at       timestamptz not null default now(),
  sent_date     date not null default ((now() at time zone 'Asia/Yerevan')::date),
  agr_no        text not null,                      -- contract / client number
  chat_id       text,                               -- telegram chat id actually used
  category      text not null,                      -- notification type
  subtype       text not null,
  language      text not null,
  full_text     text not null,                      -- the exact message that was sent
  template_id   text,
  planned_id    bigint,
  telegram_ok   boolean not null default false,
  telegram_error text
);

alter table mqa_sent_notifications enable row level security;

create index if not exists mqa_sent_notifications_agr_idx  on mqa_sent_notifications (agr_no);
create index if not exists mqa_sent_notifications_date_idx on mqa_sent_notifications (sent_date);

comment on table mqa_sent_notifications is
  'Sent-notifications log (pt.6): one row per actual bot send — date, full text, type, subtype, contract number. Surfaced read-only in the accountant app as "all notifications sent to this client". Separate from the detection-based mqa_chat_mailings.';

-- 6. Seed the template catalog ----------------------------------------------
-- DRAFT wording lifted from the standard templates already recognised by
-- mailings-detect.ts. approved=false: the sender refuses these until the owner
-- signs off on the exact client-facing text (task: "Confirm exact template
-- wording and the auto/manual split with the owner before shipping").
--
-- AUTO vs MANUAL (task-stated split):
--   debts        → AUTO   (payment / services reminders — fixed wording, from Naira)
--   primary_docs → AUTO   (standard до-28 document request — fixed wording)
--   salary       → MANUAL (accountant attaches the ведомость before it goes out)
--   main_taxes   → MANUAL (tax report — accountant provides the amounts)
--
-- Placeholders rendered at plan time: {client} = chat name, {contract} = agr_no,
-- {period} = YYYYMM cycle, {due_day} = category due day.
insert into mqa_notification_templates (id, category, subtype, language, mode, title, body, requires_attachment, approved, active)
values
  -- MANUAL: salary table (до 10)
  ('salary:done:ru', 'salary', 'done', 'ru', 'manual',
   'Зарплата — направление ведомости',
   'Здравствуйте! Направляю таблицу по заработным платам, оплаты проставлены в банке. Срок — до {due_day} числа.',
   true, false, true),
  ('salary:done:hy', 'salary', 'done', 'hy', 'manual',
   'Աշխատավարձ — աղյուսակի ուղարկում',
   'Բարև Ձեզ։ Ուղարկում եմ աշխատավարձերի աղյուսակը, վճարումները նշված են բանկում։ Ժամկետը՝ մինչև ամսվա {due_day}-ը։',
   true, false, true),

  -- MANUAL: tax report / amounts to pay (до 15)
  ('main_taxes:req:ru', 'main_taxes', 'req', 'ru', 'manual',
   'Налоги — сумма к оплате',
   'Здравствуйте! Направляю рассчитанные налоги к оплате на расчётные счета. Срок оплаты — до {due_day} числа.',
   true, false, true),
  ('main_taxes:req:hy', 'main_taxes', 'req', 'hy', 'manual',
   'Հարկեր — վճարման ենթակա գումար',
   'Բարև Ձեզ։ Ուղարկում եմ վճարման ենթակա հաշվարկված հարկերը։ Վճարման ժամկետը՝ մինչև ամսվա {due_day}-ը։',
   true, false, true),

  -- AUTO: primary document request (до 28)
  ('primary_docs:req:ru', 'primary_docs', 'req', 'ru', 'auto',
   'Первичка — запрос документов',
   'Здравствуйте! Для своевременной и корректной подготовки отчётности просим предоставить следующую информацию: инвойс, акт, счёт-фактура, данные для расчёта заработной платы. Срок — до {due_day} числа.',
   false, false, true),
  ('primary_docs:req:hy', 'primary_docs', 'req', 'hy', 'auto',
   'Առաջնային փաստաթղթեր — հարցում',
   'Բարև Ձեզ։ Հաշվետվությունը ժամանակին և ճիշտ պատրաստելու համար խնդրում ենք տրամադրել՝ ինվոյս, ակտ, հաշիվ-ապրանքագիր, աշխատավարձի հաշվարկի տվյալներ։ Ժամկետը՝ մինչև ամսվա {due_day}-ը։',
   false, false, true),

  -- AUTO: service-payment / debt reminder (до 5)
  ('debts:req:ru', 'debts', 'req', 'ru', 'auto',
   'Оплата услуг — напоминание',
   'Здравствуйте! Напоминаем о необходимости произвести оплату бухгалтерских услуг до {due_day} числа для продолжения работы.',
   false, false, true),
  ('debts:req:hy', 'debts', 'req', 'hy', 'auto',
   'Ծառայությունների վճարում — հիշեցում',
   'Բարև Ձեզ։ Հիշեցնում ենք հաշվապահական ծառայությունների վճարման անհրաժեշտության մասին՝ մինչև ամսվա {due_day}-ը, աշխատանքը շարունակելու համար։',
   false, false, true)
on conflict (id) do nothing;

-- 7. Planning function — build/refresh the 30-day chain ---------------------
-- For every Active chat, ensure a planned notification exists for the current
-- mailing cycle for EACH of the four categories (so the chain contains at least
-- one of every type the bot sends). scheduled_date = the category due day inside
-- the cycle, clamped so it is never in the past (a fresh plan schedules for the
-- next occurrence). rendered_text is produced from the matching active template
-- in the chat's language (falling back to 'ru'), with placeholders replaced.
--
-- Idempotent: never touches a row already edited/approved/cancelled/sent — only
-- (re)writes untouched 'planned' rows and inserts missing ones. Runs daily via
-- pg_cron, keeping a rolling 30-day horizon.
create or replace function public.mqa_plan_notifications(
  ref_date date default ((now() at time zone 'Asia/Yerevan')::date)
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  planned_count integer := 0;
  -- (category, subtype, due_day) — one canonical outbound per category.
  plan_spec constant text[][] := array[
    array['salary',       'done', '10'],
    array['main_taxes',   'req',  '15'],
    array['primary_docs', 'req',  '28'],
    array['debts',        'req',  '5']
  ];
  spec        text[];
  v_cat       text;
  v_sub       text;
  v_due       int;
  v_chat      record;
  v_lang      text;
  v_tpl       record;
  v_period    text;
  v_sched     date;
  v_text      text;
begin
  for v_chat in
    select agr_no, coalesce(chat_name, agr_no) as chat_name,
           coalesce(language, 'ru') as language
    from mqa_chats
    where status = 'Active'
  loop
    foreach spec slice 1 in array plan_spec loop
      v_cat := spec[1];
      v_sub := spec[2];
      v_due := spec[3]::int;
      v_lang := v_chat.language;

      -- Template in the chat language, else Russian fallback, active only.
      select * into v_tpl from mqa_notification_templates t
      where t.category = v_cat and t.subtype = v_sub and t.active
        and t.language = v_lang
      limit 1;
      if not found then
        select * into v_tpl from mqa_notification_templates t
        where t.category = v_cat and t.subtype = v_sub and t.active
          and t.language = 'ru'
        limit 1;
      end if;
      continue when not found;  -- no template for this category yet

      -- scheduled_date = this month's due day if still ahead, else next month's.
      v_sched := make_date(
        extract(year from ref_date)::int,
        extract(month from ref_date)::int,
        least(v_due, 28)
      );
      if v_sched < ref_date then
        v_sched := (v_sched + interval '1 month')::date;
      end if;
      -- The mailing cycle the scheduled date belongs to (mirrors mailingPeriodOf).
      v_period := to_char(
        case when extract(day from v_sched) >= 28
             then (v_sched + interval '1 month') else v_sched end,
        'YYYYMM'
      );

      -- Render the client-facing text.
      v_text := replace(v_tpl.body, '{client}', v_chat.chat_name);
      v_text := replace(v_text, '{contract}', v_chat.agr_no);
      v_text := replace(v_text, '{period}', v_period);
      v_text := replace(v_text, '{due_day}', v_due::text);

      insert into mqa_planned_notifications (
        agr_no, period, category, subtype, language, scheduled_date,
        template_id, mode, requires_attachment, rendered_text, status
      )
      values (
        v_chat.agr_no, v_period, v_cat, v_sub, v_tpl.language, v_sched,
        v_tpl.id, v_tpl.mode, v_tpl.requires_attachment, v_text, 'planned'
      )
      on conflict (agr_no, period, category, subtype) do update
        set scheduled_date      = excluded.scheduled_date,
            language            = excluded.language,
            template_id         = excluded.template_id,
            mode                = excluded.mode,
            requires_attachment = excluded.requires_attachment,
            rendered_text       = excluded.rendered_text,
            updated_at          = now()
        -- Only refresh rows the accountant has NOT touched.
        where mqa_planned_notifications.status = 'planned';

      planned_count := planned_count + 1;
    end loop;
  end loop;

  return planned_count;
end;
$fn$;

comment on function public.mqa_plan_notifications(date) is
  'Build/refresh the rolling 30-day planned-notification chain: one planned row per Active chat per category for the current cycle. Idempotent; only rewrites untouched planned rows. Scheduled daily via pg_cron (mqa_plan_notifications_daily).';

-- A newly created function is EXECUTE-able by PUBLIC by default. This one is
-- SECURITY DEFINER and does bulk RLS-bypassing writes over every active chat, so
-- lock it down: only the owner / pg_cron (which runs as the table owner) may
-- call it. No anon/authenticated access.
revoke all on function public.mqa_plan_notifications(date) from public;

-- Schedule: every day at 03:00 UTC = 07:00 Yerevan (before the workday), so the
-- chain is fresh when accountants open the platform.
select cron.schedule(
  'mqa_plan_notifications_daily',
  '0 3 * * *',
  $$select public.mqa_plan_notifications();$$
);

-- 8. Language backlog task (pt.4 BACKLOG) -----------------------------------
-- Do NOT build detection now — just record the follow-up so it is not lost.
create table if not exists mqa_backlog_notes (
  id         bigint generated always as identity primary key,
  topic      text not null,
  note       text not null,
  created_at timestamptz not null default now()
);
alter table mqa_backlog_notes enable row level security;

insert into mqa_backlog_notes (topic, note)
values (
  'notification-language-autodetect',
  'pt.4 BACKLOG: detect chat-name changes on mqa_chats and alert that the company language field may need updating (client switched language). Not built — mqa_chats.language is manual today.'
)
on conflict do nothing;
