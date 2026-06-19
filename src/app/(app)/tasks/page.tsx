import TasksPanel from "@/components/TasksPanel";
import { listAccountants, listChats, listTasks } from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const [chats, accountants, tasks] = await Promise.all([
    listChats(),
    listAccountants(),
    listTasks(),
  ]);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Задачи</h1>
        <p className="text-sm text-gray-500">
          Задачи с дедлайном (напр. «вернётся через 2 дня») и повторяющиеся задачи.
          Повторяющаяся задача закрывается только после подтверждения QA. Новая — в
          нижней строке.
        </p>
      </div>
      <TasksPanel
        chats={chats}
        accountants={accountants}
        initialTasks={tasks.slice(0, 100)}
      />
    </div>
  );
}
