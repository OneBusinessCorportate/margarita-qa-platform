import type { CriteriaScores, TaskStatusScores, QualityBand } from "./scoring";

export type ChatStatus = "Active" | "Inactive";

export interface Chat {
  agr_no: string; // pk, e.g. "59" or "B-3302"
  hvhh: string | null; // tax id (ՀՎՀՀ)
  name_agr: string | null; // legal/agreement name
  name_tax: string | null; // name per tax office
  status: ChatStatus;
  tax_activation_date: string | null; // ISO date
  chat_name: string;
  chat_link: string | null;
  accountant: string | null;
  manager: string | null;
  debts: string | null;
  created_date: string | null; // ISO date
}

export type AccountantRole = "accountant" | "other-specialist" | "dismissed";

export interface Accountant {
  name: string; // Armenian name, pk
  active: boolean;
  role: AccountantRole;
}

export interface Evaluation {
  id: string;
  chat_agr_no: string;
  period: string; // e.g. "202603"
  checking_date: string; // ISO date
  accountant: string | null;
  scores: {
    criteria?: CriteriaScores;
    tasks?: TaskStatusScores;
  };
  total_score: number;
  quality_band: QualityBand;
  comment: string | null;
  created_at: string; // ISO datetime
}

export type TaskStatus =
  | "Completed On Time"
  | "Late"
  | "Overdue"
  | "Cancelled";

export interface Task {
  id: string;
  chat_agr_no: string;
  type: "monthly" | "single";
  category: string;
  status: string;
  prev_status: string | null;
  due_date_original: string | null;
  due_date_postponed: string | null;
  completed_at: string | null;
  priority: number | null;
  description: string | null;
  result: string | null;
  task_status: TaskStatus | null;
}

export interface NewEvaluationInput {
  chat_agr_no: string;
  period: string;
  checking_date: string;
  accountant: string | null;
  scores: {
    criteria?: CriteriaScores;
    tasks?: TaskStatusScores;
  };
  comment: string | null;
}
