import ViolationAppealsPanel from "@/components/ViolationAppealsPanel";
import AppealsPanel from "@/components/AppealsPanel";
import { listViolationAppealViews } from "@/lib/repo";
import { listAppeals } from "@/lib/appeals-data";
import AutoRefresh from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";

export default async function AppealsPage() {
  // New violation-linked appeals (the acknowledge/appeal workflow) are the
  // primary list. Legacy accountant-feedback appeals (external kk_ tables) are
  // still shown below so nothing from the live feedback flow is lost — degrades
  // to empty when those tables aren't reachable.
  const violationAppeals = await listViolationAppealViews();
  let feedbackAppeals: Awaited<ReturnType<typeof listAppeals>> = [];
  try {
    feedbackAppeals = await listAppeals();
  } catch {
    feedbackAppeals = [];
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Апелляции</h1>
          <AutoRefresh />
        </div>
        <p className="text-sm text-gray-500">
          Апелляции бухгалтеров на нарушения. «Принять» снимает штраф по нарушению,
          «Отклонить» оставляет нарушение и штраф в силе.
        </p>
      </div>

      <ViolationAppealsPanel initialAppeals={violationAppeals} />

      {feedbackAppeals.length > 0 && (
        <div className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Апелляции из формы бухгалтеров</h2>
            <p className="text-sm text-gray-500">
              Внешние обращения по проблемам качества (форма в приложении бухгалтера).
            </p>
          </div>
          <AppealsPanel initialAppeals={feedbackAppeals} />
        </div>
      )}
    </div>
  );
}
