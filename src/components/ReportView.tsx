import { BANDS } from "@/lib/scoring";
import type { DailyReport } from "@/lib/report";

// Presentational report blocks (distribution, per-accountant, tasks), shared by
// the live dashboard and saved-snapshot views so both render the exact same way.
export default function ReportView({ report }: { report: DailyReport }) {
  return (
    <div className="space-y-4">
      {/* Distribution + service quality */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="card p-3 md:col-span-2">
          <div className="text-sm font-medium mb-2">Распределение оценок</div>
          <div className="grid grid-cols-4 gap-2">
            {BANDS.map((b) => (
              <div
                key={b.band}
                className="rounded p-2 text-white"
                style={{ backgroundColor: b.color }}
              >
                <div className="text-xs opacity-90">{b.band}</div>
                <div className="text-2xl font-semibold tabular-nums">
                  {report.distribution[b.band]}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-3 flex flex-col justify-center">
          <div className="text-sm font-medium">Сервис Бухгалтерии</div>
          <div className="text-4xl font-bold tabular-nums">
            {report.serviceQualityPct}%
          </div>
          <div className="text-xs text-gray-500">средняя оценка за период</div>
        </div>
      </div>

      {/* Per-accountant: Сервис Бухгалтерии */}
      <div className="card overflow-x-auto">
        <div className="px-3 pt-3 text-sm font-medium">Сервис Бухгалтерии — по бухгалтерам</div>
        <table className="qa">
          <thead>
            <tr>
              <th>Бухгалтер</th>
              <th>Средняя оценка %</th>
              <th>Оценено</th>
              <th>Низких оценок</th>
            </tr>
          </thead>
          <tbody>
            {report.perAccountant.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center text-gray-400 py-6">
                  Нет данных за выбранный период.
                </td>
              </tr>
            )}
            {report.perAccountant.map((a) => (
              <tr key={a.accountant}>
                <td className="font-medium">{a.accountant}</td>
                <td className="tabular-nums">{a.avgScore < 0 ? "—" : `${a.avgScore}%`}</td>
                <td className="tabular-nums">{a.count}</td>
                <td className="tabular-nums">
                  <span className={a.lowCount > 0 ? "text-red-600 font-medium" : ""}>
                    {a.lowCount}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Задачи Бухгалтерии */}
      <div className="card overflow-x-auto">
        <div className="px-3 pt-3 text-sm font-medium">
          Задачи Бухгалтерии — всего {report.tasks.total} (в срок: {report.tasks.onTime},
          с опозданием: {report.tasks.late}, просрочено: {report.tasks.overdue})
        </div>
        <table className="qa">
          <thead>
            <tr>
              <th>Бухгалтер</th>
              <th>Всего</th>
              <th>В срок</th>
              <th>С опозданием</th>
              <th>Просрочено</th>
            </tr>
          </thead>
          <tbody>
            {report.tasks.perAccountant.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-gray-400 py-6">
                  Нет задач за выбранный период.
                </td>
              </tr>
            )}
            {report.tasks.perAccountant.map((a) => (
              <tr key={a.accountant}>
                <td className="font-medium">{a.accountant}</td>
                <td className="tabular-nums">{a.total}</td>
                <td className="tabular-nums">{a.onTime}</td>
                <td className="tabular-nums">{a.late}</td>
                <td className="tabular-nums">
                  <span className={a.overdue > 0 ? "text-red-600 font-medium" : ""}>
                    {a.overdue}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
