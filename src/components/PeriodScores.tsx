import type { DailyReport } from "@/lib/report";
import { isValidEmployee } from "@/lib/valid-employees";

/**
 * «Оценки бухгалтеров по дням за период» (запрос QA: «выбрать месяц / неделю /
 * любой диапазон дат и увидеть, какие оценки получил каждый бухгалтер по дням,
 * как менялись результаты и общую динамику»).
 *
 * В отличие от старого `WeeklyScores` (жёстко 7 дней Пн–Вс с навигацией ◀/▶),
 * этот компонент строит матрицу «бухгалтер × день» за ПРОИЗВОЛЬНЫЙ выбранный
 * период (его задаёт `DashboardFilters`: Сегодня / Неделя / Месяц / свой
 * диапазон). Колонки — все дни периода; ячейка — средняя оценка бухгалтера за
 * день; справа «Средняя за период» и «Динамика» (тренд: среднее второй половины
 * периода минус среднее первой половины, ▲/▼/→). Данные — из того же движка
 * `getDailyAnalytics` (`perDayPerAccountant` / `perDay`), что и отчёт/сообщение,
 * поэтому цифры совпадают везде. Никакого PDF — это живой дашборд.
 */

const WD = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

function ddmm(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-");
  return d && m ? `${d}.${m}` : iso;
}

function weekdayOf(iso: string): string {
  const dt = new Date(iso.slice(0, 10) + "T00:00:00Z");
  return WD[dt.getUTCDay()] ?? "";
}

function scoreColor(pct: number | null): string {
  if (pct === null) return "text-gray-300";
  if (pct >= 90) return "text-green-600";
  if (pct >= 80) return "text-blue-600";
  if (pct >= 60) return "text-amber-600";
  return "text-red-600";
}

/**
 * Тренд бухгалтера за период: среднее второй половины дней-с-оценками минус
 * среднее первой половины. Возвращает null, если оценок меньше двух дней (тренд
 * посчитать не из чего). Значение — в процентных пунктах.
 */
function trend(series: number[]): number | null {
  if (series.length < 2) return null;
  const mid = Math.floor(series.length / 2);
  const first = series.slice(0, mid);
  const second = series.slice(series.length - mid);
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.round(avg(second) - avg(first));
}

export default function PeriodScores({
  report,
  days,
  periodLabel,
  today,
}: {
  report: DailyReport;
  /** All ISO dates in the selected period, ascending. */
  days: string[];
  /** Human label, e.g. «01.07 — 22.07». */
  periodLabel: string;
  today: string;
}) {
  // key `${date}|${accountant}` → { avg, count, low }
  const cell = new Map<string, { avg: number; count: number; low: number }>();
  for (const r of report.perDayPerAccountant ?? []) {
    cell.set(`${r.date}|${r.accountant}`, {
      avg: r.avgScore,
      count: r.count,
      low: r.lowCount,
    });
  }
  const perDay = new Map((report.perDay ?? []).map((d) => [d.date, d]));

  // Single-day period: getDailyAnalytics doesn't fill perDayPerAccountant, so
  // fall back to the per-accountant average as that one day's cell.
  const singleDay = days.length === 1 ? days[0] : null;

  const accountants = report.perAccountant
    .filter((a) => isValidEmployee(a.accountant))
    .map((a) => {
      if (singleDay && !cell.has(`${singleDay}|${a.accountant}`) && a.avgScore >= 0) {
        cell.set(`${singleDay}|${a.accountant}`, {
          avg: a.avgScore,
          count: a.count,
          low: 0,
        });
      }
      const series = days
        .map((d) => cell.get(`${d}|${a.accountant}`)?.avg)
        .filter((v): v is number => typeof v === "number");
      return {
        name: a.accountant,
        periodAvg: a.avgScore,
        count: a.count,
        dynamics: trend(series),
      };
    });

  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="text-sm font-semibold text-gray-700">
          Оценки бухгалтеров по дням за период
        </div>
        <div className="text-xs text-gray-400 mt-0.5">
          {periodLabel} · средняя оценка по каждому бухгалтеру за день ·
          «Динамика» = тренд за период (вторая половина минус первая)
        </div>
      </div>

      {accountants.length === 0 ? (
        <div className="p-6 text-center text-sm text-gray-400">
          За выбранный период оценок пока нет.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <th className="px-4 py-2 text-left font-medium sticky left-0 bg-gray-50">
                Бухгалтер
              </th>
              {days.map((d) => (
                <th
                  key={d}
                  className={`px-2 py-2 text-center font-medium whitespace-nowrap ${
                    d === today ? "text-blue-700" : ""
                  }`}
                >
                  {weekdayOf(d)}
                  <span className="block text-[10px] text-gray-400 tabular-nums">
                    {ddmm(d)}
                  </span>
                </th>
              ))}
              <th className="px-3 py-2 text-center font-medium">Средняя</th>
              <th className="px-3 py-2 text-center font-medium">Динамика</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {accountants.map((a) => (
              <tr key={a.name} className="hover:bg-gray-50/50">
                <td className="px-4 py-2 font-medium text-gray-800 whitespace-nowrap sticky left-0 bg-white">
                  {a.name}
                </td>
                {days.map((d) => {
                  const c = cell.get(`${d}|${a.name}`);
                  const pct = c ? c.avg : null;
                  return (
                    <td
                      key={d}
                      className={`px-2 py-2 text-center tabular-nums ${scoreColor(pct)} ${
                        d === today ? "bg-blue-50/40" : ""
                      }`}
                      title={c ? `${c.count} оц.${c.low ? `, ${c.low} низк.` : ""}` : "нет оценок"}
                    >
                      {pct === null ? "·" : `${pct}%`}
                    </td>
                  );
                })}
                <td
                  className={`px-3 py-2 text-center font-semibold tabular-nums ${scoreColor(
                    a.periodAvg < 0 ? null : a.periodAvg
                  )}`}
                >
                  {a.periodAvg < 0 ? "—" : `${a.periodAvg}%`}
                </td>
                <td className="px-3 py-2 text-center tabular-nums whitespace-nowrap">
                  {a.dynamics === null ? (
                    <span className="text-gray-300" title="мало данных для тренда">—</span>
                  ) : a.dynamics > 0 ? (
                    <span className="text-green-600" title="рост оценки за период">▲ +{a.dynamics}</span>
                  ) : a.dynamics < 0 ? (
                    <span className="text-red-600" title="снижение оценки за период">▼ {a.dynamics}</span>
                  ) : (
                    <span className="text-gray-500" title="без изменений">→ 0</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 text-xs text-gray-600 font-medium border-t-2 border-gray-200">
              <td className="px-4 py-2 sticky left-0 bg-gray-50">Среднее по отделу</td>
              {days.map((d) => {
                const s = perDay.get(d);
                const pct = s && s.evaluatedChats > 0 ? s.serviceQualityPct : null;
                return (
                  <td
                    key={d}
                    className={`px-2 py-2 text-center tabular-nums ${scoreColor(pct)}`}
                  >
                    {pct === null ? "·" : `${pct}%`}
                  </td>
                );
              })}
              <td className="px-3 py-2 text-center tabular-nums text-blue-700">
                {report.serviceQualityPct}%
              </td>
              <td className="px-3 py-2" />
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
