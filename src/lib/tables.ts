// Table names for this app. PREFIXED with `mqa_` because the target Supabase
// project (OB FAQ) is a SHARED database that already contains unrelated tables
// (including a `chats` table with real data). The prefix keeps this app fully
// isolated so nothing collides.
//
// Override the prefix via DB_TABLE_PREFIX if you ever point at a dedicated DB.
const PREFIX = process.env.DB_TABLE_PREFIX ?? "mqa_";

export const TABLES = {
  accountants: `${PREFIX}accountants`,
  chats: `${PREFIX}chats`,
  criteria: `${PREFIX}criteria`,
  evaluations: `${PREFIX}evaluations`,
  managerEvaluations: `${PREFIX}manager_evaluations`,
  tasks: `${PREFIX}tasks`,
  accountantSystemTasks: `${PREFIX}accountant_system_tasks`,
  users: `${PREFIX}users`,
  violations: `${PREFIX}violations`,
  violationAppeals: `${PREFIX}violation_appeals`,
  activeExclusions: `${PREFIX}active_exclusions`,
  activeInclusions: `${PREFIX}active_inclusions`,
  reportSnapshots: `${PREFIX}report_snapshots`,
  publishedReports: `${PREFIX}published_reports`,
  chatActivity: `${PREFIX}chat_activity`,
  unanswered: `${PREFIX}unanswered`,
  unansweredLabels: `${PREFIX}unanswered_labels`,
  debts: `${PREFIX}debts`,
  chatMailings: `${PREFIX}chat_mailings`,
  chatScoreOverrides: `${PREFIX}chat_score_overrides`,
} as const;
