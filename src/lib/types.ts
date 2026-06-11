import type { CriteriaScores, QualityBand } from "./scoring";

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
  created_date: string | null; // Date of chat creation
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
  criteria?: CriteriaScores; // accuracy, sla (+ optional fcr, clarity)
  monthly?: Record<string, MonthlyStatus>; // keyed by MonthlyCategory.id
}

export interface Evaluation {
  id: string;
  chat_agr_no: string;
  period: string; // YYYYMM, e.g. "202603"
  checking_date: string; // ISO date
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
}

export interface NewEvaluationInput {
  chat_agr_no: string;
  period: string;
  checking_date: string;
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
}
