import AppealsPanel from "@/components/AppealsPanel";
import { listAppeals } from "@/lib/appeals-data";
import AutoRefresh from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";

export default async function AppealsPage() {
  const appeals = await listAppeals();
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Апелляции</h1>
          <AutoRefresh />
        </div>
        <p className="text-sm text-gray-500">
          Апелляции бухгалтеров на проблемы качества. Одобрение снимает проблему,
          отклонение оставляет её активной.
        </p>
      </div>
      <AppealsPanel initialAppeals={appeals} />
    </div>
  );
}
