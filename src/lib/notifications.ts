// ---------------------------------------------------------------------------
// Templated client notifications — pure spec + helpers (DB-free, tested).
//
// The workflow: the platform PLANS the upcoming notifications per company for
// the next 30 days (mqa_plan_notifications, mirrored here), the accountant may
// optionally EDIT/ATTACH in the accountant app, and if they do nothing the BOT
// SENDS the planned message on scheduled_date (scripts/send-notifications.ts),
// logging every send in mqa_sent_notifications.
//
// This module is the single home for: the plan spec (which categories/subtypes
// the bot sends and when), template rendering (placeholder substitution), the
// cycle/scheduled-date arithmetic (kept in parity with the SQL planning
// function and scoring.ts mailingPeriodOf), and the "this WILL be sent" rules.
// ---------------------------------------------------------------------------

import { mailingPeriodOf } from "./scoring";
import type { Category } from "./mailings-classify";

export type NotificationSubtype = "done" | "req" | "call" | "paid" | "neg";
export type NotificationMode = "auto" | "manual";
export type NotificationLanguage = "ru" | "hy" | "en" | "zh";

export type PlannedStatus =
  | "planned"
  | "edited"
  | "approved"
  | "cancelled"
  | "sent"
  | "skipped";

/** One canonical outbound notification per category, matching the SQL plan_spec
 * in db/migrations/20260723_mqa_notifications_v1.sql. AUTO = bot sends the fixed
 * wording; MANUAL = accountant must attach a file / mark done first. */
export interface NotificationPlanItem {
  category: Category;
  subtype: NotificationSubtype;
  dueDay: number;
  mode: NotificationMode;
  requiresAttachment: boolean;
}

export const NOTIFICATION_PLAN: readonly NotificationPlanItem[] = [
  { category: "salary", subtype: "done", dueDay: 10, mode: "manual", requiresAttachment: true },
  { category: "main_taxes", subtype: "req", dueDay: 15, mode: "manual", requiresAttachment: true },
  { category: "primary_docs", subtype: "req", dueDay: 28, mode: "auto", requiresAttachment: false },
  { category: "debts", subtype: "req", dueDay: 5, mode: "auto", requiresAttachment: false },
];

export const NOTIFICATION_LANGUAGES: readonly NotificationLanguage[] = ["ru", "hy", "en", "zh"];
export const DEFAULT_LANGUAGE: NotificationLanguage = "ru";

/** Prominent, human-visible warning shown everywhere a planned message can go
 * out. Deliberately explicit (pt.3: "a clear 'this message WILL be sent'
 * warning everywhere it can go out"). */
export const WILL_SEND_WARNING =
  "⚠️ Это сообщение БУДЕТ отправлено клиенту ботом автоматически. " +
  "Отредактируйте или отмените его, если нужно — иначе оно уйдёт по расписанию.";

/** Statuses whose planned notification will still be sent by the bot. An
 * untouched 'planned' row, an 'edited' one, and an explicitly 'approved' one
 * all send; 'cancelled'/'sent'/'skipped' do not. */
export function isSendable(status: PlannedStatus): boolean {
  return status === "planned" || status === "edited" || status === "approved";
}

/** Build the template id used as the catalog primary key. */
export function templateId(
  category: Category,
  subtype: NotificationSubtype,
  language: NotificationLanguage
): string {
  return `${category}:${subtype}:${language}`;
}

/** Replace the supported {placeholders} in a template body. Unknown
 * placeholders are left untouched so a typo is visible rather than silent. */
export function renderTemplate(
  body: string,
  vars: { client?: string; contract?: string; period?: string; dueDay?: number | string }
): string {
  return body
    .replaceAll("{client}", vars.client ?? "")
    .replaceAll("{contract}", vars.contract ?? "")
    .replaceAll("{period}", vars.period ?? "")
    .replaceAll("{due_day}", vars.dueDay == null ? "" : String(vars.dueDay));
}

/**
 * The date the bot will send a category's notification, given a reference date:
 * this month's due day if it is still ahead, otherwise next month's. Mirrors the
 * SQL planning function (due day clamped to 28 so it always exists).
 */
export function scheduledDateFor(dueDay: number, refDate: Date): Date {
  const day = Math.min(dueDay, 28);
  let d = new Date(Date.UTC(refDate.getUTCFullYear(), refDate.getUTCMonth(), day));
  const ref = new Date(Date.UTC(refDate.getUTCFullYear(), refDate.getUTCMonth(), refDate.getUTCDate()));
  if (d < ref) {
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, day));
  }
  return d;
}

/** The mailing cycle (YYYYMM) a scheduled date belongs to — reuses the exact
 * cycle arithmetic the rest of the platform uses. */
export function planPeriodOf(scheduled: Date): string {
  const iso = scheduled.toISOString().slice(0, 10);
  return mailingPeriodOf(iso);
}

/** Pick the template for a chat's language, falling back to Russian. Returns the
 * matching item or null. */
export function pickTemplate<T extends { language: NotificationLanguage; active?: boolean }>(
  templates: readonly T[],
  language: NotificationLanguage
): T | null {
  const active = templates.filter((t) => t.active !== false);
  return (
    active.find((t) => t.language === language) ??
    active.find((t) => t.language === DEFAULT_LANGUAGE) ??
    null
  );
}
