import AppealsPanel from "@/components/AppealsPanel";
import { listAppeals } from "@/lib/appeals-data";

export const dynamic = "force-dynamic";

export default async function AppealsPage() {
  const appeals = await listAppeals();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Апелляции</h1>
        <p className="text-sm text-gray-500">
          Апелляции бухгалтеров на проблемы качества. Одобрение снимает проблему,
          отклонение оставляет её активной.
        </p>
      </div>
      <AppealsPanel initialAppeals={appeals} />
    </div>
  );
}
