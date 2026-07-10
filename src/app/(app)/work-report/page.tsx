import { getWorkReport } from "@/lib/appeals-data";
import { listAccountants } from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function WorkReportPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; accountant?: string };
}) {
  const from = searchParams.from || undefined;
  const to = searchParams.to || undefined;
  const accountant = searchParams.accountant || undefined;

  const [report, accountants] = await Promise.all([
    getWorkReport({ from, to, accountant }),
    listAccountants(),
  ]);

  const stats = [
    { label: "Чатов проверено", value: report.chatsChecked },
    { label: "Оценок", value: report.evaluations },
    { label: "Проблем создано", value: report.issuesCreated },
    { label: "Нарушений", value: report.violations },
    { label: "Апелляций", value: report.appeals.total },
    { label: "Ожидают решения", value: report.appeals.pending, alert: report.appeals.pending > 0 },
    { label: "Апелляций одобрено", value: report.appeals.approved },
    { label: "Апелляций отклонено", value: report.appeals.rejected },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Отчёт по работе</h1>
        <p className="text-sm text-gray-500">
          Объём проверок Маргариты: сколько чатов проверено, сколько проблем и
          нарушений создано, сколько апелляций и их решения — по периоду и
          бухгалтерам.
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
              <option key={a.name} value={a.name}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn-primary" type="submit">
          Применить
        </button>
        <a className="btn-secondary" href="/work-report">
          Сбросить
        </a>
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
        <h2 className="font-semibold mb-2">По бухгалтерам</h2>
        {report.byAccountant.length === 0 ? (
          <div className="card p-6 text-center text-sm text-gray-500">Нет данных за период.</div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="qa">
              <thead>
                <tr>
                  <th>Бухгалтер</th>
                  <th>Чатов проверено</th>
                  <th>Проблем</th>
                  <th>Нарушений</th>
                  <th>Апелляций</th>
                  <th>Одобрено</th>
                  <th>Отклонено</th>
                  <th>Ожидают</th>
                </tr>
              </thead>
              <tbody>
                {report.byAccountant.map((r) => (
                  <tr key={r.name}>
                    <td className="font-medium">{r.name}</td>
                    <td>{r.chatsChecked}</td>
                    <td>{r.issues}</td>
                    <td>{r.violations}</td>
                    <td>{r.appeals}</td>
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

      <div>
        <h2 className="font-semibold mb-2">По датам</h2>
        {report.byDate.length === 0 ? (
          <div className="card p-6 text-center text-sm text-gray-500">Нет данных за период.</div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="qa">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Чатов проверено</th>
                  <th>Проблем создано</th>
                  <th>Апелляций</th>
                </tr>
              </thead>
              <tbody>
                {report.byDate.map((d) => (
                  <tr key={d.date}>
                    <td>{d.date}</td>
                    <td>{d.chatsChecked}</td>
                    <td>{d.issues}</td>
                    <td>{d.appeals}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
