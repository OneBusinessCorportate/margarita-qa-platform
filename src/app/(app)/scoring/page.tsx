import ScoringPanel from "@/components/ScoringPanel";
import { listAccountants, listChats, listEvaluations } from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function ScoringPage() {
  const [chats, accountants, evaluations] = await Promise.all([
    listChats(),
    listAccountants(),
    listEvaluations({}),
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
        initialEvaluations={evaluations.slice(0, 500)}
      />
    </div>
  );
}
