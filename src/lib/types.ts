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
  };
}

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
}

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
}

/**
 * Registration-department weekly QA — graded per MANAGER, per WEEK (not per
 * chat), on the `registration` scheme: start 100, minus penalties.
 */
export interface ManagerEvaluation {
  id: string;
  manager: string;
  week_start: string; // ISO Monday date, e.g. "2026-06-15"
  period: string; // ISO week label, e.g. "2026-W25"
  scores: { registration: Record<string, number> }; // incident counts by PenaltyRule.id
  total_score: number; // 0..100
  quality_band: QualityBand;
  comment: string | null;
  created_at: string;
}

export interface NewManagerEvaluationInput {
  manager: string;
  week_start: string;
  period?: string;
  scores: { registration: Record<string, number> };
  comment?: string | null;
  /** Optional manual override of the computed 0..100 total. */
  total_override?: number | null;
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
  checking_date?: string | null;
  recurring?: boolean | null;
}

/** Patch for an existing task (status update / QA confirmation). */
export interface TaskPatch {
  task_status?: TaskStatus | null;
  completed_at?: string | null;
  result?: string | null;
  recurring?: boolean | null;
  qa_confirmed?: boolean | null;
  qa_confirmed_by?: string | null;
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
