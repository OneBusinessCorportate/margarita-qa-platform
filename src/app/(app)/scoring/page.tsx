import ScoringPanel from "@/components/ScoringPanel";
import {
  listAccountants,
  listActiveExclusions,
  listChatActivity,
  listChats,
  listEvaluations,
  listTasks,
} from "@/lib/repo";
import { trainAiModel } from "@/lib/ai";

export const dynamic = "force-dynamic";

export default async function ScoringPage() {
  // Only the recent window of per-day activity is needed to drive the day view;
  // bound it so the payload stays small (QA reviews recent days).
  const activityFrom = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const [chats, accountants, evaluations, tasks, exclusions, chatActivity] =
    await Promise.all([
      listChats(),
      listAccountants(),
      listEvaluations({}),
      listTasks(),
      listActiveExclusions(),
      listChatActivity(activityFrom),
    ]);

  // Default the day view to the most recent day chats were ACTUALLY active
  // (real chat activity from the live feed, kept current by the sync — normally
  // "today"), or a task touch. Evaluations are deliberately excluded: a QA
  // review isn't chat activity, and counting it made the day view default to
  // the last day something was reviewed and surface stale chats.
  const activityDates = [
    ...chats.map((c) => c.last_activity_date ?? ""),
    ...tasks.map((t) => (t.checking_date ?? t.due_date_original ?? "").slice(0, 10)),
  ].filter(Boolean);
  const latestActivityDate =
    activityDates.length > 0 ? activityDates.sort().at(-1)! : null;

  // Re-train the AI on every load from the full evaluation history in the DB —
  // each saved Margarita row is a fresh training example. Only accountant rows
  // feed the accounting model; manager/lawyer rows use a different scheme.
  const aiModel = trainAiModel(
    evaluations.filter((e) => (e.role ?? "accountant") === "accountant")
  );

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Оценка чатов</h1>
      <ScoringPanel
        chats={chats}
        accountants={accountants}
        initialEvaluations={evaluations.slice(0, 1000)}
        aiModel={aiModel}
        latestActivityDate={latestActivityDate}
        initialExclusions={exclusions}
        chatActivity={chatActivity}
        taskActivity={tasks.map((t) => ({
          chat_agr_no: t.chat_agr_no,
          date: (t.checking_date ?? t.due_date_original ?? "").slice(0, 10),
        }))}
      />
    </div>
  );
}
