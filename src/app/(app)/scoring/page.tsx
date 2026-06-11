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
        <h1 className="text-xl font-semibold">Панель оценки</h1>
        <p className="text-sm text-gray-500">
          Выберите чат, выставите оценку по критериям и сохраните. После
          сохранения появится новая пустая форма.
        </p>
      </div>
      <ScoringPanel
        chats={chats}
        accountants={accountants}
        initialEvaluations={evaluations.slice(0, 50)}
      />
    </div>
  );
}
