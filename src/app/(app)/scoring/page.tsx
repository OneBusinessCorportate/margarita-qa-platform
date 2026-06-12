import ScoringPanel from "@/components/ScoringPanel";
import { listAccountants, listChats, listEvaluations, listTasks } from "@/lib/repo";
import { trainAiModel } from "@/lib/ai";

export const dynamic = "force-dynamic";

export default async function ScoringPage() {
  const [chats, accountants, evaluations, tasks] = await Promise.all([
    listChats(),
    listAccountants(),
    listEvaluations({}),
    listTasks(),
  ]);

  // Most recent date that actually has activity, so the day view isn't empty
  // on load (with the bot feed, this will naturally be "today").
  const activityDates = [
    ...evaluations.map((e) => e.checking_date.slice(0, 10)),
    ...tasks.map((t) => (t.checking_date ?? t.due_date_original ?? "").slice(0, 10)),
  ].filter(Boolean);
  const latestActivityDate =
    activityDates.length > 0 ? activityDates.sort().at(-1)! : null;

  // Re-train the AI on every load from the full evaluation history in the DB —
  // each saved Margarita row is a fresh training example.
  const aiModel = trainAiModel(evaluations);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Оценка чатов</h1>
      <ScoringPanel
        chats={chats}
        accountants={accountants}
        initialEvaluations={evaluations.slice(0, 1000)}
        aiModel={aiModel}
        latestActivityDate={latestActivityDate}
        taskActivity={tasks.map((t) => ({
          chat_agr_no: t.chat_agr_no,
          date: (t.checking_date ?? t.due_date_original ?? "").slice(0, 10),
        }))}
      />
    </div>
  );
}
