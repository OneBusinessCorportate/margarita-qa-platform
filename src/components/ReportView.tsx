import { BANDS } from "@/lib/scoring";
import type { DailyReport } from "@/lib/report";

const INVALID_NAMES = new Set(["-", "—", "--", "#N/A", "", " "]);

function isValidName(name: string): boolean {
  return !INVALID_NAMES.has(name.trim());
}

function fmtDay(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-");
  return d && m ? `${d}.${m}` : iso;
}

interface TrendInfo {
  delta: number;
  arrow: "up" | "down" | "flat";
  prevDate: string;
  reason: string;
}

function computeTrend(report: DailyReport, prev: DailyReport): TrendInfo {
  const delta = Math.round((report.serviceQualityPct - prev.serviceQualityPct) * 10) / 10;
  const arrow = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const prevDate = fmtDay(prev.filters.to ?? prev.filters.from ?? "");

  let reason = "";
  if (report.criteriaAvg && prev.criteriaAvg) {
    const slaDiff = Math.round((report.criteriaAvg.sla - prev.criteriaAvg.sla) * 100) / 100;
    const accDiff = Math.round((report.criteriaAvg.accuracy - prev.criteriaAvg.accuracy) * 100) / 100;
    const parts: string[] = [];
    if (Math.abs(slaDiff) >= 0.05) {
      parts.push(`SLA ${slaDiff > 0 ? "улучшился" : "ухудшился"} (${slaDiff > 0 ? "+" : ""}${slaDiff.toFixed(2)})`);
    }
    if (Math.abs(accDiff) >= 0.05) {
      parts.push(`Точность ${accDiff > 0 ? "улучшилась" : "ухудшилась"} (${accDiff > 0 ? "+" : ""}${accDiff.toFixed(2)})`);
    }
    reason = parts.join(", ");
  }
  if (!reason) {
    const critDiff = report.distribution["Критично"] - prev.distribution["Критично"];
    if (critDiff > 0) reason = `критичных оценок больше на ${critDiff}`;
    else if (critDiff < 0) reason = `критичных оценок меньше на ${Math.abs(critDiff)}`;
  }

  return { delta, arrow, prevDate, reason };
}

export default function ReportView({
  report,
  previousReport,
}: {
  report: DailyReport;
  previousReport?: DailyReport | null;
}) {
  const needsAttention = report.needsAttention ?? [];
  const validAccountants = report.perAccountant.filter((a) => isValidName(a.accountant));
  const managerScores = (report.managerScores ?? []).filter((a) => isValidName(a.accountant));
  const lawyerScores = (report.lawyerScores ?? []).filter((a) => isValidName(a.accountant));

  const trend = previousReport ? computeTrend(report, previousReport) : null;

  return (
    <div className="space-y-4">
      {needsAttention.length > 0 && (
        <div className="card p-3 border-red-200 bg-red-50">
          <div className="text-sm font-semibold mb-2 text-red-700">❗ Требует внимания</div>
          <ul className="space-y-1">
            {needsAttention.map((a) => (
              <li key={a.accountant} className="text-sm flex flex-wrap gap-x-2">
                <span className="font-medium">{a.accountant}</span>
                <span className="text-red-700">— {a.reasons.join("; ")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Top row: distribution + service quality side by side */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="card p-4 md:col-span-2">
          <div className="text-sm font-semibold text-gray-700 mb-3">Распределение оценок</div>
          <div className="grid grid-cols-4 gap-2">
            {BANDS.map((b) => (
              <div
                key={b.band}
                className="rounded-lg p-3 text-white text-center shadow-sm"
                style={{ backgroundColor: b.color }}
              >
                <div className="text-xs font-medium opacity-90 mb-1">{b.band}</div>
                <div className="text-3xl font-bold tabular-nums">
                  {report.distribution[b.band]}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-4 flex flex-col justify-center gap-2">
          <div className="text-sm font-semibold text-gray-700">Сервис Бухгалтерии</div>
          <div className="flex items-baseline gap-3">
            <div className="text-5xl font-bold tabular-nums text-blue-700">
              {report.serviceQualityPct}%
            </div>
            {trend && trend.arrow !== "flat" && (
              <span
                className={`text-2xl font-bold ${
                  trend.arrow === "up" ? "text-green-600" : "text-red-600"
                }`}
              >
                {trend.arrow === "up" ? "▲" : "▼"}
              </span>
            )}
          </div>
          {trend && (
            <div className={`text-xs font-medium ${
              trend.arrow === "up" ? "text-green-600" : trend.arrow === "down" ? "text-red-600" : "text-gray-500"
            }`}>
              {trend.arrow === "up" ? "+" : trend.arrow === "down" ? "" : ""}
              {trend.delta !== 0 ? `${trend.delta > 0 ? "+" : ""}${trend.delta} п.п. к ${trend.prevDate}` : `без изменений к ${trend.prevDate}`}
              {trend.reason ? ` — ${trend.reason}` : ""}
            </div>
          )}
          <div className="text-xs text-gray-500">средняя оценка за период</div>
          {typeof report.coveragePct === "number" && (
            <div className="text-xs text-gray-400 mt-1 border-t pt-2">
              Охват: <span className="font-medium text-gray-600">{report.totals.evaluatedChats}</span> из{" "}
              <span className="font-medium text-gray-600">{report.totals.activeChats}</span> активных (
              {report.coveragePct}%)
            </div>
          )}
        </div>
      </div>

      {/* Two tables side by side: accountants + tasks */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {/* Per-accountant service quality */}
        <div className="card overflow-x-auto">
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="text-sm font-semibold text-gray-700">Сервис по бухгалтерам</div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-2 text-left font-medium">Бухгалтер</th>
                <th className="px-3 py-2 text-center font-medium">%</th>
                <th className="px-3 py-2 text-center font-medium">
                  <span title="Предупреждения / нарушения">⚠</span>
                </th>
                <th className="px-3 py-2 text-center font-medium">N</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {validAccountants.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center text-gray-400 py-6 text-sm">
                    Нет данных за выбранный период.
                  </td>
                </tr>
              )}
              {validAccountants.map((a) => {
                const pct = a.avgScore < 0 ? null : a.avgScore;
                const color =
                  pct === null
                    ? "text-gray-400"
                    : pct >= 90
                    ? "text-green-600"
                    : pct >= 80
                    ? "text-blue-600"
                    : pct >= 60
                    ? "text-amber-600"
                    : "text-red-600";
                return (
                  <tr key={a.accountant} className="hover:bg-gray-50/50">
                    <td className="px-4 py-2 font-medium text-gray-800">{a.accountant}</td>
                    <td className={`px-3 py-2 text-center font-semibold tabular-nums ${color}`}>
                      {pct === null ? "—" : `${pct}%`}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums">
                      {a.lowCount > 0 ? (
                        <span className="inline-block rounded bg-red-100 text-red-700 font-medium text-xs px-1.5 py-0.5">
                          {a.lowCount}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums text-gray-500">{a.count}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Tasks per accountant */}
        <div className="card overflow-x-auto">
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="text-sm font-semibold text-gray-700">Задачи</div>
            <div className="text-xs text-gray-400 mt-0.5">
              всего {report.tasks.total} · в срок: {report.tasks.onTime} · опоздание:{" "}
              {report.tasks.late} · просрочено: {report.tasks.overdue}
            </div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-2 text-left font-medium">Бухгалтер</th>
                <th className="px-3 py-2 text-center font-medium">Всего</th>
                <th className="px-3 py-2 text-center font-medium">В срок</th>
                <th className="px-3 py-2 text-center font-medium">Опозд.</th>
                <th className="px-3 py-2 text-center font-medium">Просроч.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {report.tasks.perAccountant.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-gray-400 py-6 text-sm">
                    Нет задач за выбранный период.
                  </td>
                </tr>
              )}
              {report.tasks.perAccountant
                .filter((a) => isValidName(a.accountant))
                .map((a) => (
                  <tr key={a.accountant} className="hover:bg-gray-50/50">
                    <td className="px-4 py-2 font-medium text-gray-800">{a.accountant}</td>
                    <td className="px-3 py-2 text-center tabular-nums text-gray-600">{a.total}</td>
                    <td className="px-3 py-2 text-center tabular-nums text-green-600">{a.onTime}</td>
                    <td className="px-3 py-2 text-center tabular-nums text-amber-600">{a.late}</td>
                    <td className="px-3 py-2 text-center tabular-nums">
                      {a.overdue > 0 ? (
                        <span className="inline-block rounded bg-red-100 text-red-700 font-medium text-xs px-1.5 py-0.5">
                          {a.overdue}
                        </span>
                      ) : (
                        <span className="text-gray-300">0</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Managers / Lawyers — shown only when there's data */}
      {[
        { title: "Менеджеры — сервис в чатах", rows: managerScores },
        { title: "Юристы — сервис в чатах", rows: lawyerScores },
      ]
        .filter((b) => b.rows.length > 0)
        .map((b) => (
          <div key={b.title} className="card overflow-x-auto">
            <div className="px-4 py-3 border-b border-gray-100">
              <div className="text-sm font-semibold text-gray-700">{b.title}</div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-2 text-left font-medium">Сотрудник</th>
                  <th className="px-3 py-2 text-center font-medium">%</th>
                  <th className="px-3 py-2 text-center font-medium">Низких</th>
                  <th className="px-3 py-2 text-center font-medium">N</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {b.rows.map((a) => {
                  const pct = a.avgScore < 0 ? null : a.avgScore;
                  const color =
                    pct === null
                      ? "text-gray-400"
                      : pct >= 90
                      ? "text-green-600"
                      : pct >= 80
                      ? "text-blue-600"
                      : pct >= 60
                      ? "text-amber-600"
                      : "text-red-600";
                  return (
                    <tr key={a.accountant} className="hover:bg-gray-50/50">
                      <td className="px-4 py-2 font-medium text-gray-800">{a.accountant}</td>
                      <td className={`px-3 py-2 text-center font-semibold tabular-nums ${color}`}>
                        {pct === null ? "—" : `${pct}%`}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums">
                        {a.lowCount > 0 ? (
                          <span className="inline-block rounded bg-red-100 text-red-700 font-medium text-xs px-1.5 py-0.5">
                            {a.lowCount}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums text-gray-500">{a.count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}
