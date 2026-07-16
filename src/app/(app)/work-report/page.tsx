import { getWorkReport } from "@/lib/appeals-data";
import { getViolationWorkflowReport, listAccountants } from "@/lib/repo";
import AutoRefresh from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";

export default async function WorkReportPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; accountant?: string };
}) {
  const from = searchParams.from || undefined;
  const to = searchParams.to || undefined;
  const accountant = searchParams.accountant || undefined;

  const [flow, fines, accountants] = await Promise.all([
    getViolationWorkflowReport({ from, to, accountant }),
    // Fines / оценки live in the existing report; kept as a secondary block.
    getWorkReport({ from, to, accountant }).catch(() => null),
    listAccountants(),
  ]);

  const stats: { label: string; value: number | string; alert?: boolean }[] = [
    { label: "Чатов проверено", value: flow.chatsChecked },
    { label: "Оценок создано", value: flow.evaluations },
    { label: "Нарушений создано", value: flow.violationsCreated },
    { label: "Бухгалтеров с нарушениями", value: flow.accountantsWithViolations },
    { label: "Ознакомлено бухгалтерами", value: flow.acknowledged },
    { label: "Подано апелляций", value: flow.appealsSubmitted },
    { label: "Ожидают решения", value: flow.appealsPending, alert: flow.appealsPending > 0 },
    { label: "Принято апелляций", value: flow.appealsApproved },
    { label: "Отклонено апелляций", value: flow.appealsRejected },
    { label: "Обработано апелляций", value: flow.appealsProcessed },
    { label: "Не обработано бухгалтерами", value: flow.unprocessedViolations, alert: flow.unprocessedViolations > 0 },
    { label: "Штрафов снято (апелляции)", value: flow.penaltiesCancelled },
    { label: "% обработки апелляций", value: `${flow.appealProcessingPct}%` },
    { label: "% реакции бухгалтеров", value: `${flow.acknowledgementPct}%` },
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
          Реальный объём работы Маргариты: проверки, нарушения, ознакомления
          бухгалтеров и апелляции с решениями — по периоду и бухгалтеру. Данные из
          сохранённых записей, обновляются автоматически.
        </p>
      </div>

      <form className="card p-3 flex flex-wrap gap-3 items-end" method="get">
        <label className="text-sm">
          <span className="block text-gray-500 mb-1">С даты</span>
          <input className="input" type="date" name="from" defaultValue={from} />
        </label>
        <label className="text-sm">
          <span className="block text-gray-500 mb-1">По дату</span>
          <input className="input" type="date" name="to" defaultValue={to} />
        </label>
        <label className="text-sm">
          <span className="block text-gray-500 mb-1">Бухгалтер</span>
          <select className="input" name="accountant" defaultValue={accountant ?? ""}>
            <option value="">Все</option>
            {accountants.map((a) => (
              <option key={a.name} value={a.name}>{a.name}</option>
            ))}
          </select>
        </label>
        <button className="btn-primary" type="submit">Применить</button>
        <a className="btn-secondary" href="/work-report">Сбросить</a>
      </form>

      <div className="flex flex-wrap gap-3">
        {stats.map((s) => (
          <div key={s.label} className={`card px-4 py-3 ${s.alert ? "ring-2 ring-amber-300" : ""}`}>
            <div className="text-2xl font-semibold">{s.value}</div>
            <div className="text-xs text-gray-500">{s.label}</div>
          </div>
        ))}
      </div>

      <div>
        <h2 className="font-semibold mb-2">По бухгалтерам — нарушения и апелляции</h2>
        {flow.byAccountant.length === 0 ? (
          <div className="card p-6 text-center text-sm text-gray-500">Нет данных за период.</div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="qa">
              <thead>
                <tr>
                  <th>Бухгалтер</th>
                  <th>Чатов проверено</th>
                  <th>Оценок</th>
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
                    <td>{r.chatsChecked}</td>
                    <td>{r.evaluations}</td>
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
