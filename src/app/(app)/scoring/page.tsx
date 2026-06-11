import ScoringPanel from "@/components/ScoringPanel";
import { listAccountants, listChats, listEvaluations, listTasks } from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function ScoringPage() {
  const [chats, accountants, evaluations, tasks] = await Promise.all([
    listChats(),
    listAccountants(),
    listEvaluations({}),
    listTasks(),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Панель оценки — чаты на сегодня</h1>
        <p className="text-sm text-gray-500">
          Список активных чатов на выбранную дату. Откройте чат по ссылке,
          проверьте коммуникацию, проставьте оценку и качество — всё в одной
          строке.
        </p>
      </div>
      <ScoringPanel
        chats={chats}
        accountants={accountants}
        initialEvaluations={evaluations.slice(0, 1000)}
        taskActivity={tasks.map((t) => ({
          chat_agr_no: t.chat_agr_no,
          date: (t.checking_date ?? t.due_date_original ?? "").slice(0, 10),
        }))}
      />
    </div>
  );
}
