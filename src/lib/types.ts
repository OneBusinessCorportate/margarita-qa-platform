import type {
  CriteriaScores,
  EvalRole,
  Greeting,
  QualityBand,
  SchemeId,
} from "./scoring";

export type { EvalRole };

export type ChatStatus = "Active" | "Inactive";

export interface Chat {
  agr_no: string; // pk, e.g. "59" or "B-3302"
  hvhh: string | null; // ՀՎՀՀ / tax id
  name_agr: string | null; // Name from agreement list
  name_tax: string | null; // Name from Tax
  status: ChatStatus;
  tax_activation_date: string | null; // Date of tax office activation
  chat_name: string;
  chat_link: string | null;
  accountant: string | null;
  /** Ручное закрепление бухгалтера (п.1): когда true, синк таблицы не
   * перезаписывает accountant значением из «Основные данные». */
  accountant_pinned?: boolean;
  manager: string | null;
  debts: string | null; // amount or "нет долга" / "--"
  /** «Долги» follow-up status derived from the OneBusiness debts system
   * (overdue + contact log) — auto-fills the scoring grid's «Долги» column. */
  debt_status?: string | null;
  created_date: string | null; // Date of chat creation
  /**
   * Date of the last real activity in the chat (last client/accountant message),
   * sourced from the Telegram bot feed / import. Used to tell a genuinely active
   * chat from one whose status flag still says "Active" but went quiet days ago.
   */
  last_activity_date?: string | null;
  /** Precise timestamp of the last message — orders chats correctly within a day. */
  last_activity_at?: string | null;
  /** Role of the last message's sender (client / accountant / manager / …). */
  last_sender_role?: string | null;
  /** True when the client had the last word — the chat is still awaiting a reply. */
  unanswered?: boolean | null;
}

export type AccountantRole = "accountant" | "other-specialist" | "dismissed";

export interface Accountant {
  name: string;
  active: boolean;
  role: AccountantRole;
}

/** Per-category monthly task status + its previous status. */
export interface MonthlyStatus {
  status: string;
  prev: string;
}

export interface EvaluationScores {
  /**
   * Which evaluation scheme produced this row. Absent ⇒ "accounting" (the
   * original weighted chat model), so existing data keeps working unchanged.
   */
  scheme?: SchemeId;
  criteria?: CriteriaScores; // accuracy, sla (+ optional fcr, clarity)
  /** Did the accountant greet / answer the greeting? Missing → accuracy ≤ 4. */
  greeting?: Greeting;
  monthly?: Record<string, MonthlyStatus>; // keyed by MonthlyCategory.id
  /** Registration scheme: incident counts keyed by PenaltyRule.id. */
  registration?: Record<string, number>;
  /** Accounting KPI scheme: percentages keyed by KpiCriterion.id. */
  kpi?: Record<string, number>;
  /** AI's predicted row at save time — the training pair for the learner. */
  ai?: {
    criteria?: CriteriaScores;
    monthly?: Record<string, { status: string }>;
    total?: number;
    /** Уверенность модели в этом прогнозе (0..100), привязана к версии. */
    confidence?: number;
  };
}

/**
 * Статус проверки AI-оценки Маргаритой (фича «Уверенность модели»):
 *   • `not_reviewed` — AI сгенерировал оценку, но Маргарита её ещё не проверяла
 *     (легаси-строки без AI-снимка тоже трактуются как «не проверено»);
 *   • `accepted`     — Маргарита приняла оценку AI без изменений;
 *   • `corrected`    — Маргарита исправила оценку AI (см. reviewed_at/by).
 */
export type ReviewStatus = "not_reviewed" | "accepted" | "corrected";

export interface Evaluation {
  id: string;
  chat_agr_no: string;
  period: string; // YYYYMM, e.g. "202603"
  checking_date: string; // ISO date
  /** Which role this row grades. Absent ⇒ "accountant" (legacy rows). */
  role: EvalRole;
  /** The graded person's name (бухгалтер / менеджер / юрист). */
  accountant: string | null;
  scores: EvaluationScores;
  total_score: number; // Общая оценка 0..100
  quality_band: QualityBand;
  comment: string | null;
  created_at: string;
  /**
   * Уверенность модели в исходной AI-оценке, 0..100 (%). `null` — данных нет
   * (легаси-строки, менеджер/юрист без прогноза): такие строки ИСКЛЮЧАЮТСЯ из
   * расчётов на основе уверенности и показываются как «Нет данных», НЕ как 0%.
   * Значение принадлежит ИМЕННО той версии оценки, что выдала модель, и не
   * перезаписывается при ручной правке.
   */
  ai_confidence?: number | null;
  /**
   * Исходная общая оценка AI (снимок `scores.ai.total`), продублирована в
   * колонку ради быстрой аналитики/корреляции без разбора JSON. Не
   * перезаписывается при последующих правках Маргариты.
   */
  ai_total?: number | null;
  /** Принято/исправлено/не проверено (см. ReviewStatus). Легаси ⇒ not_reviewed. */
  review_status?: ReviewStatus;
  /** Кто провёл проверку (принял/исправил) — email/имя из сессии. */
  reviewed_by?: string | null;
  /** Когда проведена проверка/исправление (ISO timestamp). */
  reviewed_at?: string | null;
}

export type TaskStatus =
  | "Completed (On Time)"
  | "Completed (Late)"
  | "Overdue"
  | "Cancelled"
  | "-";

export interface Task {
  id: string;
  chat_agr_no: string;
  type: "monthly" | "single";
  category: string | null;
  status: string | null;
  prev_status: string | null;
  due_date_original: string | null;
  due_date_postponed: string | null;
  completed_at: string | null;
  priority: string | null; // Low / Medium / High
  description: string | null;
  result: string | null;
  task_status: TaskStatus | null;
  accountant: string | null;
  /** Ответственный менеджер (доп. к accountant). Задачу можно назначить обоим. */
  manager: string | null;
  checking_date: string | null;
  period: string | null;
  /** Recurring / non-closable: stays open until done AND QA-confirmed. */
  recurring?: boolean | null;
  /** QA confirmed the accountant actually did it (closes a recurring task). */
  qa_confirmed?: boolean | null;
  qa_confirmed_at?: string | null;
  qa_confirmed_by?: string | null;
}

export interface NewEvaluationInput {
  chat_agr_no: string;
  period: string;
  checking_date: string;
  role?: EvalRole; // defaults to "accountant"
  accountant: string | null;
  scores: EvaluationScores;
  comment: string | null;
  /** Optional manual Общая оценка override (else computed from criteria). */
  total_override?: number | null;
  /**
   * Уверенность модели в её прогнозе (0..100). Присылается панелью вместе со
   * снимком `scores.ai` при первом сохранении. `null`/отсутствует ⇒ «Нет данных».
   */
  ai_confidence?: number | null;
}

/**
 * Единая модель статуса нарушения в рабочем цикле «бухгалтер → апелляция →
 * решение Маргариты» (Phase 11). Один и тот же набор значений используется в БД,
 * API, UI, отчётах и тестах:
 *   • `new`             — новое нарушение, бухгалтер ещё не отреагировал;
 *   • `acknowledged`    — бухгалтер нажал «Ознакомлен»;
 *   • `appealed`        — бухгалтер подал апелляцию, ждёт решения;
 *   • `appeal_approved` — Маргарита приняла апелляцию (штраф снимается);
 *   • `appeal_rejected` — Маргарита отклонила апелляцию (нарушение в силе).
 */
export type ViolationStatus =
  | "new"
  | "acknowledged"
  | "appealed"
  | "appeal_approved"
  | "appeal_rejected";

export const VIOLATION_STATUSES: ViolationStatus[] = [
  "new",
  "acknowledged",
  "appealed",
  "appeal_approved",
  "appeal_rejected",
];

export interface Violation {
  id: string;
  vdate: string; // ISO date
  accountant: string | null;
  chat_agr_no: string | null;
  client: string | null;
  severity: string | null; // Среднее / Критичное / Грубое
  violation_type: string | null;
  gross: string | null;
  sanction: number | null;
  note: string | null;
  /** Подтверждено Маргаритой (по умолчанию true — она сама вносит нарушения). */
  confirmed?: boolean;
  /**
   * Статус рабочего цикла (см. ViolationStatus). Отсутствует у легаси-строк —
   * тогда трактуется как `new` (или `appealed`/… по устаревшему appeal_status).
   */
  status?: ViolationStatus | null;
  /** Когда бухгалтер нажал «Ознакомлен» (ISO timestamp). */
  acknowledged_at?: string | null;
  /** Кто ознакомился (имя бухгалтера / email, кто зафиксировал действие). */
  acknowledged_by?: string | null;
  /**
   * Легаси-поле статуса апелляции: null | 'appealed' | 'approved' | 'rejected'.
   * Держим синхронным со `status` ради обратной совместимости (дашборд,
   * telegram, violation-report читают именно его).
   */
  appeal_status?: string | null;
  created_at: string;
}

export interface NewViolationInput {
  vdate: string;
  accountant?: string | null;
  chat_agr_no?: string | null;
  client?: string | null;
  severity?: string | null;
  violation_type?: string | null;
  gross?: string | null;
  sanction?: number | null;
  note?: string | null;
  confirmed?: boolean;
  status?: ViolationStatus | null;
  appeal_status?: string | null;
}

export type AppealStatus = "pending" | "approved" | "rejected";

/**
 * Апелляция бухгалтера на конкретное нарушение (mqa_violation_appeals). Связана
 * с нарушением по `violation_id` (FK). Одно нарушение может иметь не более одной
 * АКТИВНОЙ (pending) апелляции — гарантируется на уровне БД частичным уникальным
 * индексом и проверкой в репозитории.
 */
export interface ViolationAppeal {
  id: string;
  violation_id: string;
  /** Кто подал (имя бухгалтера — ключ для сведения в отчётах). */
  accountant: string | null;
  /** Текст объяснения бухгалтера (обязателен, не пустой). */
  appeal_text: string;
  status: AppealStatus;
  /** Комментарий Маргариты к решению (необязателен, особенно при отклонении). */
  decision_comment: string | null;
  /** Кто вынес решение. */
  resolved_by: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface NewViolationAppealInput {
  violation_id: string;
  accountant?: string | null;
  appeal_text: string;
}

export interface NewTaskInput {
  chat_agr_no: string;
  type?: "monthly" | "single";
  category?: string | null;
  due_date_original?: string | null;
  due_date_postponed?: string | null;
  description?: string | null;
  priority?: string | null;
  completed_at?: string | null;
  result?: string | null;
  task_status?: TaskStatus | null;
  accountant?: string | null;
  manager?: string | null;
  checking_date?: string | null;
  recurring?: boolean | null;
}

/** Patch for an existing task (status update / QA confirmation). */
export interface TaskPatch {
  task_status?: TaskStatus | null;
  due_date_original?: string | null;
  due_date_postponed?: string | null;
  completed_at?: string | null;
  result?: string | null;
  recurring?: boolean | null;
  qa_confirmed?: boolean | null;
  qa_confirmed_by?: string | null;
}

/**
 * Отдельный трекер «Системные задачи бухгалтеров» (п.6). НЕ смешивается с
 * апелляциями (ViolationAppeal) и с общими задачами по чатам (Task). Может быть
 * мягко связана с QA-тикетом (ticket_id → mqa_violations.id).
 */
export type SystemTaskStatus =
  | "new"
  | "in_progress"
  | "postponed"
  | "completed"
  | "cancelled";

export type SystemTaskPriority = "Low" | "Medium" | "High";

export interface AccountantSystemTask {
  id: string;
  ticket_id: string | null;
  accountant_name: string | null;
  client_name: string | null;
  chat_id: string | null;
  title: string;
  description: string | null;
  priority: SystemTaskPriority;
  status: SystemTaskStatus;
  due_date_original: string | null;
  due_date_postponed: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewSystemTaskInput {
  ticket_id?: string | null;
  accountant_name?: string | null;
  client_name?: string | null;
  chat_id?: string | null;
  title: string;
  description?: string | null;
  priority?: SystemTaskPriority;
  status?: SystemTaskStatus;
  due_date_original?: string | null;
  due_date_postponed?: string | null;
  created_by?: string | null;
}

export interface SystemTaskPatch {
  status?: SystemTaskStatus;
  priority?: SystemTaskPriority;
  title?: string;
  description?: string | null;
  accountant_name?: string | null;
  client_name?: string | null;
  chat_id?: string | null;
  ticket_id?: string | null;
  due_date_original?: string | null;
  due_date_postponed?: string | null;
  completed_at?: string | null;
}

/**
 * A chat manually hidden from the scoring page's "Активные за день" list for a
 * specific day (QA decided it isn't worth reviewing). Per-(chat, day): hiding a
 * chat one day never affects another day.
 */
export interface ActiveExclusion {
  chat_agr_no: string;
  exclude_date: string; // ISO date
}

/**
 * A chat Margarita manually pulled INTO the scoring page's "Активные за день"
 * list for a specific day — even though the activity feed didn't surface it
 * (a chat from a previous day, or one missing from the feed). Per-(chat, day),
 * the mirror image of ActiveExclusion. Removing it just deletes the row.
 */
export interface ActiveInclusion {
  chat_agr_no: string;
  include_date: string; // ISO date
}

/**
 * A manual chat-score override for a single day (Маргарита, п.8). Append-only:
 * each edit is a new row and the LATEST row per (chat_agr_no, score_date) is the
 * effective manual score. Older rows form the audit history (кто/когда/старая/
 * новая/комментарий). A manual override takes priority over the auto-computed
 * evaluation total for that (chat, day) in the dashboard, reports and PDF.
 */
export interface ScoreOverride {
  id: string;
  chat_agr_no: string;
  client_name: string | null;
  score_date: string; // ISO date
  old_score: number | null;
  new_score: number; // 0..100
  changed_by: string | null;
  comment: string;
  created_at: string;
}

export interface NewScoreOverrideInput {
  chat_agr_no: string;
  score_date: string;
  new_score: number;
  /** Required justification for the manual edit. */
  comment: string;
  old_score?: number | null;
  client_name?: string | null;
  changed_by?: string | null;
}

/**
 * One detected or manually-confirmed mailing event per (chat, period, category).
 * Auto-detected rows (source='telegram') are overwritten on each scan;
 * manual rows (source='manual') are locked and never overwritten.
 */
export interface ChatMailing {
  agr_no: string;
  period: string; // YYYYMM
  category: string; // main_taxes / salary / primary_docs / debts
  status: string; // mailing status string
  source: "telegram" | "manual";
  confirmed: boolean;
  confirmed_by: string | null;
  confirmed_at: string | null;
  detected_at: string | null;
}
