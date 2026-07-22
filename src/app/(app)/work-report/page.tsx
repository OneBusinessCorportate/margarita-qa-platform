import { getWorkReport } from "@/lib/appeals-data";
import { getAnalytics, getViolationWorkflowReport, listAccountants } from "@/lib/repo";
import DashboardFilters from "@/components/DashboardFilters";
import AnalyticsTable from "@/components/AnalyticsTable";
import AutoRefresh from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";

function fmtDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d && m ? `${d}.${m}.${y}` : iso;
}

export default async function WorkReportPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; accountant?: string; client?: string };
}) {
  const filters = {
    from: searchParams.from || undefined,
    to: searchParams.to || undefined,
    accountant: searchParams.accountant || undefined,
    client: searchParams.client || undefined,
  };

  // getAnalytics разрешает окно (последний оценённый день по умолчанию); передаём
  // это же окно в остальные отчёты, чтобы все цифры на странице были за один период.
  const { report: analytics, resolved } = await getAnalytics(filters);
  const win = { from: resolved.from, to: resolved.to, accountant: filters.accountant };

  const [flow, fines, accountants] = await Promise.all([
    getViolationWorkflowReport(win),
    getWorkReport(win).catch(() => null),
    listAccountants(),
  ]);

  const { totals } = analytics;
  const periodLabel =
    resolved.from === resolved.to
      ? fmtDay(resolved.from)
      : `${fmtDay(resolved.from)} — ${fmtDay(resolved.to)}`;

  // Полная сводка QA + рабочего цикла (не только штрафы/апелляции).
  const stats: { label: string; value: number | string; alert?: boolean }[] = [
    { label: "Проверено бухгалтеров", value: totals.accountantsReviewed },
    { label: "Чатов проверено", value: totals.chatsChecked },
    { label: "Проверок (оценок)", value: totals.evaluations },
    { label: "Средняя оценка", value: totals.avgScore >= 0 ? `${totals.avgScore}%` : "—" },
    { label: "Критичных оценок", value: totals.critical, alert: totals.critical > 0 },
    { label: "Нарушений", value: totals.violations },
    { label: "Ознакомлено", value: flow.acknowledged },
    { label: "Не обработано", value: flow.unprocessedViolations, alert: flow.unprocessedViolations > 0 },
    { label: "Подано апелляций", value: totals.appeals },
    { label: "Принято апелляций", value: totals.appealsApproved },
    { label: "Отклонено апелляций", value: totals.appealsRejected },
    { label: "Ожидают решения", value: totals.appealsPending, alert: totals.appealsPending > 0 },
  ];

  const drams = (n: number) => `${n.toLocaleString("ru-RU")} др.`;

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Отчёт по работе</h1>
          <AutoRefresh />
        </div>
        <p className="text-sm text-gray-500">
          Полный отчёт по работе бухгалтеров за <span className="font-medium">{periodLabel}</span>:
          качество (оценки, чаты), нарушения, ознакомления, апелляции с решениями и штрафы. Данные
          из сохранённых записей, обновляются автоматически.
        </p>
      </div>

      <div className="no-print">
        <DashboardFilters
          accountants={accountants.map((a) => a.name)}
          initial={filters}
          basePath="/work-report"
        />
      </div>

      <div className="flex flex-wrap gap-3">
        {stats.map((s) => (
          <div key={s.label} className={`card px-4 py-3 ${s.alert ? "ring-2 ring-amber-300" : ""}`}>
            <div className="text-2xl font-semibold">{s.value}</div>
            <div className="text-xs text-gray-500">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Полная статистика QA по бухгалтерам (оценки + нарушения + апелляции). */}
      <div>
        <h2 className="font-semibold mb-2">Полная статистика по бухгалтерам</h2>
        <AnalyticsTable rows={analytics.perAccountant} />
      </div>

      {/* Рабочий цикл: ознакомления и необработанные нарушения (детально). */}
      <div>
        <h2 className="font-semibold mb-2">Нарушения и апелляции — рабочий цикл</h2>
        {flow.byAccountant.length === 0 ? (
          <div className="card p-6 text-center text-sm text-gray-500">Нет данных за период.</div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="qa">
              <thead>
                <tr>
                  <th>Бухгалтер</th>
                  <th>Нарушений</th>
                  <th>Ознакомлено</th>
                  <th>Не обработано</th>
                  <th>Апелляций</th>
                  <th>Принято</th>
                  <th>Отклонено</th>
                  <th>Ожидают</th>
                </tr>
              </thead>
              <tbody>
                {flow.byAccountant.map((r) => (
                  <tr key={r.name}>
                    <td className="font-medium">{r.name}</td>
                    <td>{r.violations}</td>
                    <td>{r.acknowledgements}</td>
                    <td className={r.unprocessed > 0 ? "text-amber-600 font-medium" : ""}>{r.unprocessed}</td>
                    <td>{r.appealsSubmitted}</td>
                    <td>{r.approved}</td>
                    <td>{r.rejected}</td>
                    <td>{r.pending}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {fines && fines.byAccountant.length > 0 && (
        <div>
          <h2 className="font-semibold mb-2">Штрафы за период</h2>
          <div className="card overflow-x-auto">
            <table className="qa">
              <thead>
                <tr>
                  <th>Бухгалтер</th>
                  <th>Нарушений</th>
                  <th>Предупр.</th>
                  <th>Штрафов</th>
                  <th>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {fines.byAccountant
                  .filter((r) => r.violations > 0)
                  .map((r) => (
                    <tr key={r.name}>
                      <td className="font-medium">{r.name}</td>
                      <td>{r.violations}</td>
                      <td>{r.warnings}</td>
                      <td>{r.penalties}</td>
                      <td className="tabular-nums">{drams(r.fineTotal)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
