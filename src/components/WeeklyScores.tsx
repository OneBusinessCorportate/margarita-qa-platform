import Link from "next/link";
import type { DailyReport } from "@/lib/report";
import { isValidEmployee } from "@/lib/valid-employees";

/**
 * История оценок за неделю (п.6). Полная таблица «бухгалтер × день недели»:
 * строки — действующие бухгалтеры, колонки — Пн…Вс выбранной недели, ячейка —
 * средняя оценка бухгалтера за этот день. Справа — среднее за неделю, снизу —
 * средняя по отделу за каждый день. Навигация ◀/▶ переключает недели (текущая и
 * предыдущие), поэтому Маргарита видит и сегодня, и прошлые дни/недели без PDF.
 *
 * Данные приходят из того же движка `buildReport` (многодневное окно →
 * `perDayPerAccountant` / `perDay`), что и недельные PDF/сообщение, поэтому
 * цифры на экране и в выгрузке всегда совпадают.
 */
const WD = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function ddmm(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-");
  return d && m ? `${d}.${m}` : iso;
}

function scoreColor(pct: number | null): string {
  if (pct === null) return "text-gray-300";
  if (pct >= 90) return "text-green-600";
  if (pct >= 80) return "text-blue-600";
  if (pct >= 60) return "text-amber-600";
  return "text-red-600";
}

export default function WeeklyScores({
  report,
  weekDays,
  weekLabel,
  prevHref,
  nextHref,
  today,
}: {
  report: DailyReport;
  /** Seven ISO dates, Monday → Sunday. */
  weekDays: string[];
  /** Human label, e.g. «06.07 – 12.07». */
  weekLabel: string;
  prevHref: string;
  /** null when the shown week is already the current week (no future weeks). */
  nextHref: string | null;
  today: string;
}) {
  // key `${date}|${accountant}` → { avg, count }
  const cell = new Map<string, { avg: number; count: number; low: number }>();
  for (const r of report.perDayPerAccountant ?? []) {
    cell.set(`${r.date}|${r.accountant}`, {
      avg: r.avgScore,
      count: r.count,
      low: r.lowCount,
    });
  }
  const perDay = new Map(
    (report.perDay ?? []).map((d) => [d.date, d])
  );

  // Rows: valid accountants that have at least one evaluation in the week.
  const accountants = report.perAccountant
    .filter((a) => isValidEmployee(a.accountant))
    .map((a) => ({ name: a.accountant, weekAvg: a.avgScore, count: a.count }));

  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-gray-700">
            История оценок за неделю
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            {weekLabel} · средняя оценка по каждому бухгалтеру за день
          </div>
        </div>
        <div className="flex items-center gap-2 no-print">
          <Link href={prevHref} className="btn-secondary text-sm" aria-label="Предыдущая неделя">
            ← Пред.
          </Link>
          {nextHref ? (
            <Link href={nextHref} className="btn-secondary text-sm" aria-label="Следующая неделя">
              След. →
            </Link>
          ) : (
            <span className="btn-secondary text-sm opacity-40 cursor-default select-none">
              След. →
            </span>
          )}
        </div>
      </div>

      {accountants.length === 0 ? (
        <div className="p-6 text-center text-sm text-gray-400">
          За эту неделю оценок пока нет.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <th className="px-4 py-2 text-left font-medium sticky left-0 bg-gray-50">
                Бухгалтер
              </th>
              {weekDays.map((d) => (
                <th
                  key={d}
                  className={`px-2 py-2 text-center font-medium whitespace-nowrap ${
                    d === today ? "text-blue-700" : ""
                  }`}
                >
                  {WD[weekDays.indexOf(d)]}
                  <span className="block text-[10px] text-gray-400 tabular-nums">
                    {ddmm(d)}
                  </span>
                </th>
              ))}
              <th className="px-3 py-2 text-center font-medium">Неделя</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {accountants.map((a) => (
              <tr key={a.name} className="hover:bg-gray-50/50">
                <td className="px-4 py-2 font-medium text-gray-800 whitespace-nowrap sticky left-0 bg-white">
                  {a.name}
                </td>
                {weekDays.map((d) => {
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
                    a.weekAvg < 0 ? null : a.weekAvg
                  )}`}
                >
                  {a.weekAvg < 0 ? "—" : `${a.weekAvg}%`}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 text-xs text-gray-600 font-medium border-t-2 border-gray-200">
              <td className="px-4 py-2 sticky left-0 bg-gray-50">Среднее по отделу</td>
              {weekDays.map((d) => {
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
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
