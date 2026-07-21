import SystemTasksPanel from "@/components/SystemTasksPanel";
import AutoRefresh from "@/components/AutoRefresh";
import { listAccountants, listAccountantSystemTasks } from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function SystemTasksPage() {
  const [accountants, tasks] = await Promise.all([
    listAccountants(),
    listAccountantSystemTasks().catch(() => []),
  ]);
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
        <h1 className="text-xl font-semibold">Системные задачи бухгалтеров</h1>
        <p className="text-sm text-gray-500">
          Отдельный трекер задач бухгалтеров — не смешивается с апелляциями. Если
          по QA-тикету нужно действие, оно попадает сюда: статусы «Новая → В работе →
          Отложена → Выполнена / Отменена», приоритет, сроки (оригинальный и
          перенесённый), автор и время выполнения.
        </p>
        </div>
        <AutoRefresh />
      </div>
      <SystemTasksPanel accountants={accountants} initialTasks={tasks.slice(0, 2000)} />
    </div>
  );
}
