// In-memory store used when Supabase is not configured. Persists for the life
// of the server process (resets on restart). Seeded from seed-data.ts.
import type {
  Accountant,
  AccountantSystemTask,
  ActiveExclusion,
  ActiveInclusion,
  Chat,
  Evaluation,
  ScoreOverride,
  Task,
  Violation,
  ViolationAppeal,
} from "./types";
import type { ReportSnapshot } from "./report";
import {
  seedAccountants,
  seedChats,
  seedEvaluations,
  seedTasks,
  seedViolations,
  seedViolationAppeals,
} from "./seed-data";

interface StoredUser {
  email: string;
  password_hash: string;
}

interface Store {
  chats: Chat[];
  accountants: Accountant[];
  evaluations: Evaluation[];
  tasks: Task[];
  users: StoredUser[];
  violations: Violation[];
  violationAppeals: ViolationAppeal[];
  accountantSystemTasks: AccountantSystemTask[];
  activeExclusions: ActiveExclusion[];
  activeInclusions: ActiveInclusion[];
  reportSnapshots: ReportSnapshot[];
  scoreOverrides: ScoreOverride[];
}

// Use a global to survive module reloads in Next dev (HMR).
const g = globalThis as unknown as { __qaStore?: Store };

export function store(): Store {
  if (!g.__qaStore) {
    g.__qaStore = {
      chats: structuredClone(seedChats),
      accountants: structuredClone(seedAccountants),
      evaluations: structuredClone(seedEvaluations),
      tasks: structuredClone(seedTasks),
      users: [],
      violations: structuredClone(seedViolations),
      violationAppeals: structuredClone(seedViolationAppeals),
      accountantSystemTasks: [],
      activeExclusions: [],
      activeInclusions: [],
      reportSnapshots: [],
      scoreOverrides: [],
    };
  }
  return g.__qaStore;
}
