// In-memory store used when Supabase is not configured. Persists for the life
// of the server process (resets on restart). Seeded from seed-data.ts.
import type {
  Accountant,
  Chat,
  Evaluation,
  ManagerEvaluation,
  Task,
  Violation,
} from "./types";
import {
  seedAccountants,
  seedChats,
  seedEvaluations,
  seedTasks,
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
  managerEvaluations: ManagerEvaluation[];
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
      violations: [],
      managerEvaluations: [],
    };
  }
  return g.__qaStore;
}
